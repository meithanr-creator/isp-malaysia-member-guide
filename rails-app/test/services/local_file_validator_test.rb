require "test_helper"
require "stringio"

class LocalFileValidatorTest < ActiveSupport::TestCase
  FakeUpload = Struct.new(:original_filename, :content_type, :content, :reported_size) do
    def size = reported_size || content.bytesize
    def read(length) = stream.read(length)
    def rewind = stream.rewind
    def stream = @stream ||= StringIO.new(content.b)
  end

  test "supported image signatures and PDF pass and rewind the upload" do
    [
      ["sample.jpg", "image/jpeg", "\xFF\xD8\xFFsample".b, :image],
      ["sample.png", "image/png", "\x89PNG\r\n\x1A\nsample".b, :image],
      ["sample.webp", "image/webp", "RIFF1234WEBPsample", :image],
      ["sample.pdf", "application/pdf", "%PDF-1.7 sample", :pdf]
    ].each do |name, type, bytes, kind|
      file = FakeUpload.new(name, type, bytes)
      assert_nil LocalFileValidator.error(file, kind: kind), name
      assert_equal bytes.b, file.read(bytes.bytesize).b, "validator must rewind #{name}"
    end
  end

  test "a renamed executable cannot pass image or PDF checks" do
    assert LocalFileValidator.error(FakeUpload.new("pretend.png", "image/png", "MZ executable"), kind: :image)
    assert LocalFileValidator.error(FakeUpload.new("pretend.pdf", "application/pdf", "MZ executable"), kind: :pdf)
  end

  test "SVG GIF wrong MIME and empty files are rejected" do
    [
      FakeUpload.new("vector.svg", "image/svg+xml", "<svg></svg>"),
      FakeUpload.new("animated.gif", "image/gif", "GIF89a"),
      FakeUpload.new("wrong.jpg", "image/jpeg", "\x89PNG\r\n\x1A\n".b),
      FakeUpload.new("empty.png", "image/png", "")
    ].each { |file| assert LocalFileValidator.error(file, kind: :image), file.original_filename }
  end

  test "image and PDF size limits reject oversized files" do
    image = FakeUpload.new("large.png", "image/png", "\x89PNG\r\n\x1A\n".b, 5.megabytes + 1)
    pdf = FakeUpload.new("large.pdf", "application/pdf", "%PDF-1.7", 10.megabytes + 1)
    assert_match(/too large/, LocalFileValidator.error(image, kind: :image))
    assert_match(/too large/, LocalFileValidator.error(pdf, kind: :pdf))
  end
end
