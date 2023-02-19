package com.youjf.simplebin.controller

import com.youjf.simplebin.model.Content
import org.springframework.http.HttpEntity
import org.springframework.http.HttpHeaders.AUTHORIZATION
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

@RestController
interface ContentController {
    @GetMapping(
        "/",
        headers = ["Accept=text/html"],
        produces = ["text/html;charset=UTF-8"],
    )
    @ResponseStatus(HttpStatus.OK)
    fun getContentBrowser(): HttpEntity<ByteArray>

    @GetMapping("/")
    @ResponseStatus(HttpStatus.OK)
    fun getContentLatest(): HttpEntity<Content>

    @GetMapping("/plain")
    @ResponseStatus(HttpStatus.OK)
    fun getContentPlain(): HttpEntity<ByteArray>

    @GetMapping("/json")
    @ResponseStatus(HttpStatus.OK)
    fun getContentJson(): HttpEntity<Content>

    @GetMapping(
        "/{id}",
        produces = ["text/html;charset=UTF-8"],
    )
    @ResponseStatus(HttpStatus.OK)
    fun getContentById(
        @PathVariable("id") id: String,
    ): HttpEntity<ByteArray>

    @GetMapping("/{id}/json")
    @ResponseStatus(HttpStatus.OK)
    fun getContentJsonById(
        @PathVariable("id") id: String,
    ): HttpEntity<Content>

    @PostMapping("/")
    @ResponseStatus(HttpStatus.CREATED)
    fun createContent(
        @RequestHeader(AUTHORIZATION, required = false) authHeader: String?,
        @RequestBody request: String,
    ): HttpEntity<Content>

    @PostMapping(
        "/",
        consumes = [
            MediaType.MULTIPART_FORM_DATA_VALUE,
        ],
    )
    @ResponseStatus(HttpStatus.CREATED)
    fun createContentFile(
        @RequestHeader(AUTHORIZATION, required = false) authHeader: String?,
        @RequestParam("file") file: MultipartFile,
    ): HttpEntity<Content>
}
