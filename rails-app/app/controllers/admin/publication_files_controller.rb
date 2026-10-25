module Admin
  class PublicationFilesController < ApplicationController
    before_action :require_admin

    def show
      response.headers["Cache-Control"] = "no-store, private"
      return head :not_found unless %w[cover pdf].include?(params[:kind])
      publication = Publication.find_by!(slug: params[:publication_id])
      snapshot = case params[:version].presence || "draft"
      when "draft" then publication.draft_data
      when "preview"
        return head :not_found unless publication.preview_current? && params[:revision].to_s.match?(/\A\d+\z/) && params[:revision].to_i == publication.preview_revision
        publication.preview_data
      when "published"
        return head :not_found unless publication.published?
        publication.published_data
      else
        return head :not_found
      end
      file = snapshot&.fetch(params[:kind], nil)
      return head :not_found unless file.is_a?(Hash) && file["signed_id"] == params[:key].to_s
      blob = publication.file_blob(file, kind: params[:kind])
      return head :not_found unless blob
      disposition = params[:kind] == "pdf" ? "attachment" : "inline"
      send_data blob.download, filename: blob.filename.to_s, type: blob.content_type, disposition: disposition
    end
  end
end
