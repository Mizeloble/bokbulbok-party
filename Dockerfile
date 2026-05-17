FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 크레딧 식별자 빌드 시 주입 (미전달 시 i18n.ts의 공개 fallback 사용).
# 사내 배포는 CI가 GitHub Actions secret에서 --build-arg로 넘김.
ARG NEXT_PUBLIC_CREDIT_ORG
ARG NEXT_PUBLIC_CREDIT_AUTHOR
ARG NEXT_PUBLIC_CREDIT_AUTHOR_URL
ENV NEXT_PUBLIC_CREDIT_ORG=$NEXT_PUBLIC_CREDIT_ORG
ENV NEXT_PUBLIC_CREDIT_AUTHOR=$NEXT_PUBLIC_CREDIT_AUTHOR
ENV NEXT_PUBLIC_CREDIT_AUTHOR_URL=$NEXT_PUBLIC_CREDIT_AUTHOR_URL
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
