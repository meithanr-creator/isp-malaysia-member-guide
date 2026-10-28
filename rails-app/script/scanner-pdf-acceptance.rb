# Actual scanner-only verification of the exact hosted PDF fixture. No Rails/DB/R2.
require "digest"
require "stringio"
require_relative "../deployment/cloudflare/supervisor"
require_relative "../app/services/upload_scanner"
eicar = ["X5O!P%@AP[4", "\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join
objects = [
  "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.txt) 7 0 R] >> >> >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
  "<< /Length 0 >>\nstream\n\nendstream",
  "<< /Producer (ISP controlled scanner acceptance) >>",
  "<< /Type /EmbeddedFile /Subtype /text#2Fplain /Length #{eicar.bytesize} >>\nstream\n#{eicar}\nendstream",
  "<< /Type /Filespec /F (eicar.txt) /EF << /F 6 0 R >> >>"
]
bytes = "%PDF-1.4\n"; offsets = []
objects.each_with_index { |item, index| offsets << bytes.bytesize; bytes << "#{index+1} 0 obj\n#{item}\nendobj\n" }
xref = bytes.bytesize
bytes << "xref\n0 8\n0000000000 65535 f \n"
offsets.each { |position| bytes << "#{position.to_s.rjust(10, '0')} 00000 n \n" }
bytes << "trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n#{xref}\n%%EOF\n"
expected = "d5315912278b2fc47c9fea68c974a4225a6f7ca9690f0477ce71f22ceb86018a"
raise "Hosted and scanner PDF fixtures differ" unless eicar.bytesize == 68 && Digest::SHA256.hexdigest(bytes) == expected
if ARGV == ['--fixture-only']
  puts "Exact PDF fixture:#{bytes.bytesize}bytes;sha256=#{expected};no scanner or network invocation"
  exit 0
end
raise 'Unsupported scanner acceptance argument' unless ARGV.empty?
smoke = lambda do
  scanner = UploadScanner.new(env: {"CLAMD_HOST"=>"127.0.0.1", "CLAMD_PORT"=>"3310"})
  file = StringIO.new(bytes)
  result = scanner.scan(file)
  raise "Embedded EICAR did not receive explicit detection" unless result == "This file did not pass the upload safety check. Choose another file."
  raise "Rejected PDF received clean metadata" unless UploadScanner.metadata(file).empty?
  puts "Exact hosted PDF scanner fixture passed:834bytes;sha256=#{expected};EICAR detected;no database/storage invocation"
end
supervisor = IspCloudflare::Supervisor.new(smoke: smoke)
%w[TERM INT].each { |signal| Signal.trap(signal) { supervisor.request_stop } }
exit(supervisor.run)
