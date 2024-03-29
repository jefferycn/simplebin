package com.youjf.simplebin.service

import com.youjf.simplebin.config.AppConfig
import com.youjf.simplebin.controller.ContentController
import com.youjf.simplebin.model.Content
import org.apache.commons.codec.digest.DigestUtils.sha256Hex
import org.apache.commons.validator.routines.UrlValidator
import org.apache.tika.Tika
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.hateoas.server.mvc.linkTo
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Service
import org.springframework.web.multipart.MultipartFile
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.attribute.BasicFileAttributes

@Service
class ContentService(
    @Autowired val properties: AppConfig,
) {
    private fun getMostRecentFile(folder: Path): Path? {
        val filter = Files.newDirectoryStream(folder) { p -> p.toFile().isFile }
        return filter.use { dir ->
            dir.asSequence()
                .map {
                    Pair(it, Files.readAttributes(it, BasicFileAttributes::class.java))
                }
                .maxByOrNull {
                    it.second.lastModifiedTime().toInstant()
                }
                ?.first
        }
    }

    fun getLatestContent() = getMostRecentFile(Paths.get(properties.path))?.toFile()

    fun getContent(id: String) = properties.path.let { path ->
        File("$path/$id").let {
            if (it.exists()) {
                it
            } else {
                null
            }
        }
    }

    fun createContent(request: String) = properties.path.let {
        sha256Hex(request).substring(0, 10).let { id ->
            File(File(it), id).writeBytes(request.toByteArray())
            getCreatedResponse(id)
        }
    }

    fun createContentFile(file: MultipartFile) = properties.path.let {
        sha256Hex(file.bytes).substring(0, 10).let { id ->
            File(File(it), id).writeBytes(file.bytes)
            getCreatedResponse(id)
        }
    }

    private fun getCreatedResponse(id: String) = ResponseEntity.ok().body(
        Content(
            id = id,
            body = linkTo<ContentController> {
                getContentById(id)
            }.toString(),
        ).add(
            linkTo<ContentController> {
                getContentJsonById(id)
            }.withSelfRel(),
        ),
    )

    fun getContentBody(file: File): ResponseEntity<Content> = ResponseEntity.ok()
        .body(
            file.name.let { id ->
                Tika().detect(file).let { contentType ->
                    Content(
                        id = id,
                        type = Tika().detect(file),
                        body = if (contentType == MediaType.TEXT_PLAIN_VALUE && file.length() < 1024) {
                            file.readText()
                        } else {
                            linkTo<ContentController> {
                                getContentJsonById(id)
                            }.toString()
                        },
                    ).add(
                        linkTo<ContentController> {
                            getContentJsonById(id)
                        }.withSelfRel(),
                        linkTo<ContentController> {
                            getContentById(id)
                        }.withRel { "raw" },
                    )
                }
            },
        )

    fun getRawBody(file: File): ResponseEntity<ByteArray> = Tika().detect(file).let { contentType ->
        when (contentType) {
            MediaType.TEXT_PLAIN_VALUE -> if (UrlValidator().isValid(file.readText())) {
                ResponseEntity(
                    HttpHeaders().apply {
                        location = URI(file.readText())
                    },
                    HttpStatus.FOUND,
                )
            } else {
                ResponseEntity.ok().body(file.readBytes())
            }

            else ->
                ResponseEntity
                    .ok()
                    .contentType(
                        MediaType.valueOf(contentType),
                    )
                    .body(file.readBytes())
        }
    }

    fun getPlainBody(file: File): ResponseEntity<ByteArray> = Tika().detect(file).let { contentType ->
        when (contentType) {
            MediaType.TEXT_PLAIN_VALUE -> ResponseEntity.ok().body(file.readBytes())
            else -> ResponseEntity.ok().body(
                linkTo<ContentController> {
                    getContentJsonById(file.name)
                }.toString().toByteArray(),
            )
        }
    }
}
