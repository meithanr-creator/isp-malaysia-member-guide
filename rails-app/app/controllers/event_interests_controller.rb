class EventInterestsController < ApplicationController
  before_action :find_published_event
  before_action :require_member
  def new
    @interest = current_user.event_interests.find_or_initialize_by(event: @event)
    @interest.assign_attributes(name: current_user.name, email: current_user.email, company: current_user.company) if @interest.new_record?
  end
  def create
    @interest = current_user.event_interests.find_or_initialize_by(event: @event)
    if @interest.update(params.require(:event_interest).permit(:name, :email, :company))
      redirect_to event_path(@event), notice: "Your demo interest is saved. Find it in your Dashboard."
    else
      render :new, status: :unprocessable_entity
    end
  end
  def destroy
    current_user.event_interests.find_by(event: @event)&.destroy!
    redirect_to member_dashboard_path, notice: "Demo interest withdrawn."
  end
  private
  def find_published_event
    @event = Event.published.find_by!(slug: params[:event_id])
    session[:return_to] = new_event_interest_path(@event) unless current_user
  end
end
