Rails.application.routes.draw do
  root "home#index"
  get "about", to: "home#about"
  get "activation", to: "account_activations#edit", as: :activation
  patch "activation", to: "account_activations#update"
  get "password-recovery", to: "password_recoveries#new", as: :password_recovery
  post "password-recovery", to: "password_recoveries#create"
  get "password-recovery/reset", to: "password_recoveries#edit", as: :password_recovery_reset
  patch "password-recovery/reset", to: "password_recoveries#update"
  get "two-factor/recovery-codes", to: "two_factor#recovery_codes", as: :two_factor_recovery_codes
  get "two-factor", to: "two_factor#new", as: :two_factor
  post "two-factor", to: "two_factor#create"
  delete "two-factor", to: "two_factor#destroy"
  get "login", to: "sessions#new"
  post "session", to: "sessions#create"
  delete "session", to: "sessions#destroy"
  post "demo_session", to: "sessions#demo" unless Rails.env.production?
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
    get "verification", to: "verifications#new", as: :verification
    post "verification", to: "verifications#create"
    post "membership_registry_entries/:id/invitation", to: "account_invitations#create", as: :membership_invitation
    resources :membership_registry_entries, only: [:index]
    resources :membership_imports, only: [:new, :create, :show] do
      member { post :confirm }
    end
    resources :consultation_requests, only: %i[index show]
    resources :publications, except: %i[show destroy] do
      member do
        get :preview
        post :prepare_preview
        post :publish
      end
      get "files/:kind/:key", to: "publication_files#show", as: :file
    end
    post "discover/setup", to: "discover_slides#setup", as: :discover_setup
    get "discover", to: "discover_slides#index", as: :discover
    patch "discover/:id", to: "discover_slides#update", as: :discover_slide
    resources :events, except: %i[show destroy] do
      get "interests", to: "event_interests#index"
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
  get "app-ready", to: "health#application_ready", as: :application_readiness
  get "ready", to: "health#ready"

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  get "manifest" => "rails/pwa#manifest", as: :pwa_manifest, defaults: { format: :json }
  get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker, defaults: { format: :js }

  # Defines the root path route ("/")
  # root "posts#index"
end
