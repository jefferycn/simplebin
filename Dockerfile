FROM node:14.15.4
WORKDIR /app
COPY package* ./
RUN npm ci
COPY . .

VOLUME ["/app/bin"]
EXPOSE 3000

ENTRYPOINT ["npm", "start"]
