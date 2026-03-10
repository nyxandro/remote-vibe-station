FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache bash curl git github-cli openssh-client docker-cli docker-cli-compose

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --chmod=755 github-git-credential.js /usr/local/bin/github-git-credential.js
COPY --chmod=755 github-gh-auth-wrapper.sh /usr/local/bin/gh

CMD ["node", "dist/main.js"]
