# args without default values
ARG VITE_SLACK_APP_SUPABASE_API_URL=default \
    VITE_SLACK_APP_SUPABASE_ANON_KEY=default
FROM node as builder

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json yarn.lock ./
COPY apps/ ./apps/
COPY packages/ ./packages/

# important to preview env var with VITE so that is included in the build artifact
ENV VITE_SLACK_APP_SUPABASE_API_URL=${VITE_SLACK_APP_SUPABASE_API_URL}
ENV VITE_SLACK_APP_SUPABASE_ANON_KEY=${VITE_SLACK_APP_SUPABASE_ANON_KEY}

RUN echo "ARG VITE_SLACK_APP_SUPABASE_API_URL: ${VITE_SLACK_APP_SUPABASE_API_URL}"

# verify environment vars
RUN export

RUN yarn install --frozen-lockfile 
RUN yarn build

FROM node:slim as runner

ENV NODE_ENV production
USER node

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json yarn.lock ./

RUN yarn install --production --frozen-lockfile

COPY --from=builder /usr/src/app/ .

EXPOSE 3000
CMD export; yarn run:slack-app