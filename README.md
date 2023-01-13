# Simplebin

This a very simple implementation to save your text, links, images or any other files. You own host your service, thus you have full control of you data.

## Install

This application is built using Spring Boot 3. You can either use prebuilt docker image or build from source. Java 18 is required to build the application. 

### Docker

Run it on port `8080`, save data in folder `/path/to/data` with no password.
```shell
docker run -p 8080:8080 -v /path/to/data:/data jefferycn/simplebin
```

Run it with password `0D1A8BA9428D`

```shell
docker run -p 8080:8080 -v /path/to/data:/data -e TOKEN=0D1A8BA9428D jefferycn/simplebin
```

### Build from source

```shell
./gradlew build
java -jar build/libs/simplebin-0.0.1-SNAPSHOT.jar
```

## Usage

You can use the application by using any http client.

### Curl

Create a text with password `0D1A8BA9428D`.
```shell
curl --location --request POST 'http://localhost:8080/' \
--header 'Authorization: Bearer 0D1A8BA9428D' \
--header 'Content-Type: text/plain' \
--data-raw 'Made by Jeffery'
```

Create a link.
```shell
curl --location --request POST 'http://localhost:8080/' \
--header 'Content-Type: text/plain' \
--data-raw 'https://youjf.com'
```

Create a file.

```shell
curl --location --request POST 'http://localhost:8080/' \
--form 'file=@"/path/to/your/file.ext"'
```

Get the last item.

```shell
curl --location --request GET 'http://localhost:8080/'
```

Get the last item and force it to text.

```shell
curl --location --request GET 'http://localhost:8080/plain'
```

Get the last item with json format.

```shell
curl --location --request GET 'http://localhost:8080/json'
```

Get specified item, client will get 302 if it's a link.

```shell
curl --location --request GET 'http://localhost:8080/2ae02ae2e7'
```

Get specified item using json format, the real content will be ignored if it's not text or link.

```shell
curl --location --request GET 'http://localhost:8080/2ae02ae2e7/json'
```

### iOS

### AutoHotkey on PC
