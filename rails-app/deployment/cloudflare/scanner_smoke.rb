# frozen_string_literal: true
require "stringio"
require_relative "../../app/services/upload_scanner"

module IspCloudflare
  module ScannerSmoke
    def self.run
      scanner = UploadScanner.new(env: { "CLAMD_HOST" => "127.0.0.1", "CLAMD_PORT" => "3310" })
      raise "Scanner not fresh/ready" if scanner.readiness_error
      clean = StringIO.new("ISP synthetic clean scanner smoke content\n")
      raise "Clean stream was rejected" if scanner.scan(clean)
      raise "Clean stream has no integrity evidence" unless UploadScanner.metadata(clean)["scan_status"] == "clean" &&
        UploadScanner.metadata(clean)["scan_sha256"] == Digest::SHA256.hexdigest(clean.string)
      # Standard benign EICAR test bytes assembled in memory; never written to disk.
      test_bytes = ["X5O!P%@AP[4", "\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join
      infected = StringIO.new(test_bytes)
      result = scanner.scan(infected)
      raise "EICAR did not receive an explicit detection" unless result&.include?("did not pass")
      raise "Rejected bytes received clean metadata" unless UploadScanner.metadata(infected).empty?
      puts "Scanner smoke passed: fresh signatures, clean INSTREAM, EICAR blocked; no Rails/database/storage invocation"
      true
    end
  end
end
