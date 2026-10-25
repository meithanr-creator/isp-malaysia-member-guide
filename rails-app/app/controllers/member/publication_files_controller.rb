module Member
  class PublicationFilesController < ApplicationController
    before_action :require_member

    def show
      response.headers["Cache-Control"] = "no-store, private"
      return head :not_found unless %w[cover pdf].include?(params[:kind])
      publication = Publication.published.find_by!(slug: params[:publication_id])
      raise ActiveRecord::RecordNotFound unless publication.published?
      file = publication.published_data[params[:kind]]
      return head :not_found unless file.is_a?(Hash) && file["signed_id"] == params[:key].to_s
      blob = publication.file_blob(file, kind: params[:kind])
      return head :not_found unless blob
      disposition = params[:kind] == "pdf" ? "attachment" : "inline"
      send_data blob.download, filename: blob.filename.to_s, type: blob.content_type, disposition: disposition
    end
  end
end
