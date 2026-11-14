# SimpleBin v2：多阶段构建，最终镜像只含静态二进制（约 21MB）。
# 构建阶段
FROM golang:1.27.4-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /simplebin .

# 运行阶段：scratch，无 shell、无包管理器，攻击面最小。
# 二进制是纯静态的（CGO_ENABLED=0），不需要任何运行时依赖。
FROM scratch
ENV DATA_DIR=/data
COPY --from=build /simplebin /simplebin
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/simplebin"]
