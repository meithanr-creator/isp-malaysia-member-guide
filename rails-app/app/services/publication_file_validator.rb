class PublicationFileValidator
  def self.error(file, kind:)
    return "Choose a file from your device." unless file.respond_to?(:original_filename)
    return LocalFileValidator.error(file, kind: :image) if kind.to_s == "cover"
    return "Choose a non-empty PDF book." if file.size.zero?
    return "The PDF book is too large (maximum 25 MB)." if file.size > 25.megabytes
    header = file.read(5).b
    file.rewind
    return if file.content_type == "application/pdf" && header.start_with?("%PDF-".b)
    "Choose a valid PDF book. The file contents must match the PDF type."
  end
end
