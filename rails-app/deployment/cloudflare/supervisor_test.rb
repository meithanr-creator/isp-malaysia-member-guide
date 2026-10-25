# frozen_string_literal: true
ENV["MT_NO_PLUGINS"] = "1"
require "minitest/autorun"
require "socket"
require "timeout"
require_relative "supervisor"

class CloudflareSupervisorTest < Minitest::Test
  class FakeProcesses
    attr_reader :starts, :stopped
    def initialize(events, update_success: true, fail_child: nil)
      @events, @update_success, @fail_child = events, update_success, fail_child
      @starts, @reported, @stopped = [], {}, false
    end
    def start(label, _command)
      @starts << label
      @events << label
    end
    def exited
      if @starts.include?(:signature_update) && !@reported[:signature_update]
        @reported[:signature_update] = true
        { signature_update: @update_success }
      elsif @fail_child && @starts.include?(@fail_child) && !@reported[@fail_child]
        @reported[@fail_child] = true
        { @fail_child => false }
      else
        {}
      end
    end
    def stop_all = @stopped = true
  end

  class FakeProbe
    def initialize(events, answers)
      @events, @answers = events, answers.dup
    end
    def ready?
      result = @answers.length > 1 ? @answers.shift : @answers.first
      @events << (result ? :scanner_ready : :scanner_not_ready)
      result
    end
  end

  def test_no_rails_process_starts_until_a_fresh_scanner_is_ready
    events = []
    processes = FakeProcesses.new(events, fail_child: :rails)
    result = supervisor(processes, FakeProbe.new(events, [false, false, true])).run
    assert_equal 1, result
    assert_equal [:signature_update, :clamd, :freshclam, :rails], processes.starts
    assert_operator events.index(:scanner_ready), :<, events.index(:rails)
    assert processes.stopped
  end

  def test_failed_initial_updates_never_start_scanner_or_rails
    events = []
    processes = FakeProcesses.new(events, update_success: false)
    assert_equal 1, supervisor(processes, FakeProbe.new(events, [true])).run
    assert_equal [:signature_update], processes.starts
    assert processes.stopped
  end

  def test_scanner_startup_timeout_is_bounded_and_fail_closed
    events = []
    processes = FakeProcesses.new(events)
    assert_equal 1, supervisor(processes, FakeProbe.new(events, [false]), startup_timeout: 0.5).run
    assert_equal [:signature_update, :clamd], processes.starts
    assert processes.stopped
  end

  def test_signature_freshness_loss_stops_an_already_running_rails_process
    events = []
    processes = FakeProcesses.new(events)
    assert_equal 1, supervisor(processes, FakeProbe.new(events, [true, false]), tick: 15).run
    assert_includes processes.starts, :rails
    assert processes.stopped
  end

  def test_stop_request_stops_all_children_without_an_error_exit
    events = []
    processes = FakeProcesses.new(events)
    clock = 0.0
    runner = nil
    sleeper = ->(seconds) { clock += seconds; runner.request_stop if processes.starts.include?(:rails) }
    runner = IspCloudflare::Supervisor.new(processes: processes, probe: FakeProbe.new(events, [true]),
      clock: -> { clock }, sleeper: sleeper, env: {}, logger: ->(_line) {})
    assert_equal 0, runner.run
    assert processes.stopped
  end

  def test_external_scanner_configuration_is_rejected_before_any_child_starts
    events = []
    processes = FakeProcesses.new(events)
    runner = supervisor(processes, FakeProbe.new(events, [true]), env: { "CLAMD_HOST" => "scanner.example.test" })
    assert_equal 1, runner.run
    assert_empty processes.starts
    assert processes.stopped
  end

  def test_scanner_only_smoke_mode_starts_no_rails_and_calls_no_database
    events = []
    processes = FakeProcesses.new(events)
    smoke_ran = false
    runner = supervisor(processes, FakeProbe.new(events, [true]), smoke: -> { smoke_ran = true })
    assert_equal 0, runner.run
    assert smoke_ran
    assert_equal [:signature_update, :clamd], processes.starts
    assert processes.stopped
  end

  def test_actual_scanner_readiness_protocol_rejects_old_future_and_unsupported_versions
    now = Time.utc(2026, 10, 26, 0, 0, 0)
    [ ["ClamAV 1.4.6/12345/#{now.rfc2822}", true],
      ["ClamAV 1.4.6/12345/#{(now - 49 * 3600).rfc2822}", false],
      ["ClamAV 1.4.6/12345/#{(now + 2 * 3600).rfc2822}", false],
      ["ClamAV 0.103.12/12345/#{now.rfc2822}", false], ["ClamAV 1.4.6", false] ].each do |response, expected|
      with_scanner(response: response, now: now) do |scanner|
        assert_equal expected, IspCloudflare::ScannerProbe.new(scanner: scanner).ready?
      end
    end
  end

  def test_encrypted_and_limit_protocol_detections_never_receive_clean_metadata
    require "stringio"
    now = Time.utc(2026, 10, 26, 0, 0, 0)
    ["Heuristics.Encrypted.PDF", "Heuristics.Encrypted.Zip", "Heuristics.Limits.Exceeded.MaxFiles"].each do |detection|
      with_scanner(response: "ClamAV 1.4.6/12345/#{now.rfc2822}", now: now, detection: detection) do |scanner|
        file = StringIO.new("synthetic protocol test")
        assert_includes scanner.scan(file), "did not pass"
        assert_empty UploadScanner.metadata(file)
      end
    end
  end

  def test_committed_daemon_config_keeps_tcp_local_and_enables_fail_closed_policies
    config = File.read(File.join(__dir__, "clamd.conf"))
    %w[ScanPDF ScanArchive HeuristicAlerts AlertEncryptedArchive AlertEncryptedDoc AlertExceedsMax].each do |directive|
      assert_match(/^#{directive} yes$/, config)
    end
    assert_match(/^TCPAddr 127\.0\.0\.1$/, config)
    assert_match(/^TCPSocket 3310$/, config)
    refute_match(/^TCPAddr (?:0\.0\.0\.0|::)$/, config)
    assert_match(/^MaxScanTime 12000$/, config)
    assert_match(/^ConcurrentDatabaseReload no$/, config)
  end

  private

  def supervisor(processes, probe, startup_timeout: 300, tick: nil, env: {}, smoke: nil)
    clock = 0.0
    IspCloudflare::Supervisor.new(processes: processes, probe: probe, clock: -> { clock },
      sleeper: ->(seconds) { clock += tick || seconds }, env: env, startup_timeout: startup_timeout,
      logger: ->(_line) {}, smoke: smoke)
  end

  def with_scanner(response:, now:, detection: nil)
    server = TCPServer.new("127.0.0.1", 0)
    commands = Queue.new
    worker = Thread.new do
      socket = server.accept
      commands << socket.gets("\0")
      socket.write("#{response}\0")
      socket.close
      if detection
        socket = server.accept
        commands << socket.gets("\0")
        loop do
          size = socket.read(4).unpack1("N")
          break if size.zero?
          socket.read(size)
        end
        socket.write("stream: #{detection} FOUND\0")
        socket.close
      end
    end
    scanner = UploadScanner.new(env: { "CLAMD_HOST" => "127.0.0.1", "CLAMD_PORT" => server.addr[1].to_s }, clock: -> { now })
    yield scanner
    assert_equal "zVERSION\0", Timeout.timeout(2) { commands.pop }
    assert_equal "zINSTREAM\0", Timeout.timeout(2) { commands.pop } if detection
  ensure
    server&.close
    worker&.join(2)
    worker&.kill if worker&.alive?
    worker&.join
  end
end
