class DiscoverImagesController < ApplicationController
  def show
    response.headers["Cache-Control"] = "no-store"
    slide = DiscoverSlide.find(params[:id])
    return head :not_found unless slide.image.attached?
    blob = slide.image.blob
    return head :not_found unless blob.signed_id == params[:key].to_s
    bytes = UploadScanner.download(blob)
    return head :not_found unless bytes
    response.headers["X-Content-Type-Options"] = "nosniff"
    send_data bytes, filename: blob.filename.to_s, type: blob.content_type, disposition: "inline"
  end
end


