FROM bellsoft/liberica-openjdk-alpine:19
ENV DATA_DIR=/data
ENV TOKEN=""
RUN addgroup -S spring && \
    adduser -S spring -G spring && \
    mkdir ${DATA_DIR} && \
    chown spring:spring ${DATA_DIR}
USER spring:spring
COPY build/libs/*.jar app.jar
ENTRYPOINT ["java","-jar","/app.jar"]
