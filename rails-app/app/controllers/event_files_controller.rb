class EventFilesController < ApplicationController
  def show
    response.headers["Cache-Control"] = "no-store, private"
    event = Event.find_by!(slug: params[:event_id])
    key = params[:key].to_s
    public_file = event.published? && referenced?(event.published_data, key)
    unless public_file
      return head :not_found unless current_user&.admin?
      return head :not_found unless referenced?(event.draft_data, key) || referenced?(event.preview_data, key)
    end
    blob = ActiveStorage::Blob.find_signed(key)
    return head :not_found unless blob && event.uploads.blobs.exists?(id: blob.id)
    disposition = blob.content_type == "application/pdf" ? "attachment" : "inline"
    bytes = UploadScanner.download(blob)
    return head :not_found unless bytes
    response.headers["X-Content-Type-Options"] = "nosniff"
    send_data bytes, filename: blob.filename.to_s, type: blob.content_type, disposition: disposition
  end

  private
  def referenced?(data, key)
    return false unless data.is_a?(Hash)
    (Array(data["images"]) + [data["brochure"]].compact).any? { |file| file["signed_id"] == key }
  end
end




