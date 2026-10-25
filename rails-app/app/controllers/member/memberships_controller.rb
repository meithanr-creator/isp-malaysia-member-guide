module Member
  class MembershipsController < ApplicationController
    before_action :require_member
    def show; end
  end
end
