# frozen_string_literal: true

require "net/http"
require_relative "../../app/services/upload_scanner"

module IspCloudflare
  class StartupError < StandardError; end
  class ShutdownRequested < StandardError; end

  class ScannerProbe
    def initialize(scanner: UploadScanner.new(env: { "CLAMD_HOST" => "127.0.0.1", "CLAMD_PORT" => "3310" }))
      @scanner = scanner
    end
    def ready? = @scanner.readiness_error.nil?
  end

  class Processes
    def initialize
      @children = {}
    end
    def start(label, command)
      @children[label] = Process.spawn(*command, pgroup: true)
    end
    def exited
      @children.keys.filter_map do |label|
        result = Process.waitpid2(@children.fetch(label), Process::WNOHANG)
        if result
          @children.delete(label)
          [label, result.last.success?]
        end
      end.to_h
    end
    def stop_all(grace: 20)
      @children.each_value { |pid| signal("TERM", pid) }
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + grace
      until @children.empty? || Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        exited
        sleep 0.1
      end
      @children.each_value { |pid| signal("KILL", pid) }
      @children.each_value { |pid| Process.waitpid(pid) rescue Errno::ECHILD }
      @children.clear
    end
    private
    def signal(name, pid)
      Process.kill(name, -pid)
    rescue Errno::ESRCH
      nil
    end
  end

  class Supervisor
    FRESHCLAM = ["/usr/local/bin/freshclam", "--stdout", "--config-file=/etc/clamav/freshclam.conf"].freeze
    CLAMD = ["/usr/local/sbin/clamd", "--foreground", "--config-file=/etc/clamav/clamd.conf"].freeze
    RAILS = ["bundle", "exec", "puma", "-C", "config/puma.rb"].freeze

    def initialize(processes: Processes.new, probe: ScannerProbe.new,
      clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }, sleeper: ->(seconds) { sleep seconds },
      env: ENV, startup_timeout: 300, logger: ->(line) { $stdout.puts(line) }, smoke: nil)
      @processes, @probe, @clock, @sleeper, @env = processes, probe, clock, sleeper, env
      @startup_timeout, @logger, @smoke = startup_timeout, logger, smoke
      @stopping = false
    end
    def request_stop = @stopping = true

    def run
      validate_local_scanner!
      deadline = @clock.call + @startup_timeout
      @processes.start(:signature_update, FRESHCLAM)
      loop do
        check_stop!
        exits = @processes.exited
        if exits.key?(:signature_update)
          raise StartupError, "Initial signature update failed" unless exits.fetch(:signature_update)
          break
        end
        check_deadline!(deadline)
        @sleeper.call(0.1)
      end
      @processes.start(:clamd, CLAMD)
      loop do
        check_stop!
        raise StartupError, "Scanner exited before readiness" unless @processes.exited.empty?
        check_deadline!(deadline)
        remaining = deadline - @clock.call
        ready = begin
          Timeout.timeout([remaining, UploadScanner::TIMEOUT_SECONDS].min) { @probe.ready? }
        rescue Timeout::Error
          false
        end
        break if ready
        check_deadline!(deadline)
        @sleeper.call(0.2)
      end
      if @smoke
        @smoke.call
        return 0
      end
      @processes.start(:freshclam, FRESHCLAM + ["--daemon", "--foreground"])
      @processes.start(:rails, RAILS)
      next_probe = @clock.call + 30
      loop do
        check_stop!
        raise StartupError, "A required child exited" unless @processes.exited.empty?
        if @clock.call >= next_probe
          raise StartupError, "Scanner freshness/readiness lost" unless @probe.ready?
          next_probe = @clock.call + 30
        end
        @sleeper.call(0.2)
      end
    rescue ShutdownRequested
      @logger.call("Container stopping; forwarding TERM to managed processes")
      0
    rescue StandardError => error
      # Do not print environment, credentials, request data or arbitrary child arguments.
      @logger.call("Container stopped before further service: #{error.class}")
      1
    ensure
      @processes.stop_all
    end

    def self.http_ready?(env: ENV)
      host = env.fetch("APP_HOST")
      http = Net::HTTP.new("127.0.0.1", 3000, nil)
      http.open_timeout = 3
      http.read_timeout = 20
      response = http.get("/ready", { "Host" => host })
      response.code == "200" && response.body == "ready"
    rescue StandardError
      false
    end

    private
    def validate_local_scanner!
      unless @env.fetch("CLAMD_HOST", "127.0.0.1") == "127.0.0.1" && @env.fetch("CLAMD_PORT", "3310") == "3310"
        raise StartupError, "Scanner must remain local"
      end
      raise StartupError, "Pinned scanner is no longer accepted by app policy" unless UploadScanner::SUPPORTED_ENGINES.include?("1.4.6")
    end
    def check_stop!
      raise ShutdownRequested if @stopping
    end
    def check_deadline!(deadline)
      raise StartupError, "Scanner startup budget exceeded" if @clock.call >= deadline
    end
  end
end

if $PROGRAM_NAME == __FILE__
  abort "Runtime must use a non-root account" if Process.uid.zero?
  case ARGV
  when ["--check"]
    exit(IspCloudflare::Supervisor.http_ready? ? 0 : 1)
  when [], ["--scanner-smoke"]
    smoke = nil
    if ARGV == ["--scanner-smoke"]
      require_relative "scanner_smoke"
      smoke = -> { IspCloudflare::ScannerSmoke.run }
    end
    supervisor = IspCloudflare::Supervisor.new(smoke: smoke)
    %w[TERM INT].each { |signal| Signal.trap(signal) { supervisor.request_stop } }
    exit(supervisor.run)
  else
    abort "Only normal start, --check or --scanner-smoke is supported; no migration command is run"
  end
end
