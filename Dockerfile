FROM node as builder

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json yarn.lock ./
COPY apps/ ./apps/
COPY packages/ ./packages/

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