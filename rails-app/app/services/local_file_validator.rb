class LocalFileValidator
  def self.error(file, kind:)
    return "Choose a non-empty file." if file.size.zero?
    limit = kind == :image ? 5.megabytes : 10.megabytes
    return "#{file.original_filename} is too large (maximum #{kind == :image ? '5' : '10'} MB)." if file.size > limit
    header = file.read(12).b
    file.rewind
    valid = if kind == :pdf
      file.content_type == "application/pdf" && header.start_with?("%PDF-".b)
    else
      case file.content_type
      when "image/jpeg" then header.start_with?("\xFF\xD8\xFF".b)
      when "image/png" then header.start_with?("\x89PNG\r\n\x1A\n".b)
      when "image/webp" then header.start_with?("RIFF".b) && header.byteslice(8, 4) == "WEBP"
      else false
      end
    end
    return UploadScanner.error(file) if valid
    "Choose a valid #{kind == :pdf ? 'PDF document' : 'JPG, PNG or WebP image'}. The file contents must match its type."
  end
end
