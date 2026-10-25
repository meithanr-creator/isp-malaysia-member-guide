class DiscoverImagesController < ApplicationController
  def show
    response.headers["Cache-Control"] = "no-store"
    slide = DiscoverSlide.find(params[:id])
    return head :not_found unless slide.image.attached?
    blob = slide.image.blob
    return head :not_found unless blob.signed_id == params[:key].to_s
    send_data blob.download, filename: blob.filename.to_s, type: blob.content_type, disposition: "inline"
  end
end
