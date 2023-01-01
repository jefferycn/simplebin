package com.youjf.simplebin.controller

import com.youjf.simplebin.model.Content
import org.springframework.http.HttpEntity
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile

@RestController
interface ContentController {
    @GetMapping(
        "/",
        headers = ["Accept=text/html"],
        produces = ["text/html;charset=UTF-8"]
    )
    @ResponseStatus(HttpStatus.OK)
    fun getContentBrowser(): HttpEntity<ByteArray>

    @GetMapping("/")
    @ResponseStatus(HttpStatus.OK)
    fun getContent(): HttpEntity<Content>

    @GetMapping("/plain")
    @ResponseStatus(HttpStatus.OK)
    fun getContentPlain(): HttpEntity<ByteArray>

    @GetMapping("/json")
    @ResponseStatus(HttpStatus.OK)
    fun getContentBrowserJson(): HttpEntity<Content>

    @GetMapping(
        "/{id}",
        produces = ["text/html;charset=UTF-8"]
    )
    @ResponseStatus(HttpStatus.OK)
    fun getContentRaw(
        @PathVariable("id") id: String
    ): HttpEntity<ByteArray>

    @GetMapping("/{id}/json")
    @ResponseStatus(HttpStatus.OK)
    fun getContent(
        @PathVariable("id") id: String
    ): HttpEntity<Content>

    @PostMapping("/")
    @ResponseStatus(HttpStatus.CREATED)
    fun createContent(
        @RequestBody request: String
    ): HttpEntity<Content>

    @PostMapping(
        "/",
        consumes = [
            MediaType.MULTIPART_FORM_DATA_VALUE
        ]
    )
    @ResponseStatus(HttpStatus.CREATED)
    fun createContentFile(
        @RequestParam("file") file: MultipartFile
    ): HttpEntity<Content>
}
