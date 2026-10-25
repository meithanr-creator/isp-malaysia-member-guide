Rails.application.routes.draw do
  root "home#index"
  get "about", to: "home#about"
  get "login", to: "sessions#new"
  post "session", to: "sessions#create"
  delete "session", to: "sessions#destroy"
  post "demo_session", to: "sessions#demo"
  get "event-files/:event_id/:key", to: "event_files#show", as: :event_file
  get "discover-images/:id/:key", to: "discover_images#show", as: :discover_image
  resources :events, only: %i[index show] do
    resource :interest, only: %i[new create destroy], controller: "event_interests"
  end
  namespace :member do
    get "dashboard", to: "dashboards#show"
    resource :membership, only: :show
    resources :consultation_requests, only: %i[index new create show]
    resources :publications, only: %i[index show] do
      get "files/:kind/:key", to: "publication_files#show", as: :file
    end
    resource :profile, only: %i[edit update]
  end
  namespace :admin do
    resources :consultation_requests, only: %i[index show]
    resources :publications, except: %i[show destroy] do
      member do
        get :preview
        post :prepare_preview
        post :publish
      end
      get "files/:kind/:key", to: "publication_files#show", as: :file
    end
    get "discover", to: "discover_slides#index", as: :discover
    patch "discover/:id", to: "discover_slides#update", as: :discover_slide
    resources :events, except: %i[show destroy] do
      member do
        get :preview
        post :prepare_preview
        post :publish
      end
    end
  end
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  # Defines the root path route ("/")
  # root "posts#index"
end
