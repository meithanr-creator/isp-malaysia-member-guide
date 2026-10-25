# Build with: docker build -t isp-member-rails .
# The runtime needs externally managed PostgreSQL, private S3, SMTP and clamd.
ARG RUBY_VERSION=3.4.12
FROM ruby:${RUBY_VERSION}-slim AS base
WORKDIR /rails
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates libpq5 libvips && rm -rf /var/lib/apt/lists/*
ENV RAILS_ENV=production BUNDLE_DEPLOYMENT=1 BUNDLE_PATH=/usr/local/bundle BUNDLE_WITHOUT=development:test

FROM base AS build
RUN apt-get update -qq && apt-get install --no-install-recommends -y build-essential git libpq-dev pkg-config && rm -rf /var/lib/apt/lists/*
COPY Gemfile Gemfile.lock ./
RUN bundle install && bundle exec bootsnap precompile --gemfile
COPY . .
# This narrow task is the only permitted dummy-secret boot path; no runtime
# secret, database, bucket or SMTP credential is baked into the image.
RUN SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile

FROM base
RUN groupadd --system --gid 1000 rails && useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build --chown=rails:rails /rails /rails
USER 1000:1000
EXPOSE 3000
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]
