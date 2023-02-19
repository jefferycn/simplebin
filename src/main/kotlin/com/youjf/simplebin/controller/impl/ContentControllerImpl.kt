package com.youjf.simplebin.controller.impl

import com.youjf.simplebin.controller.ContentController
import com.youjf.simplebin.model.AuthHeader
import com.youjf.simplebin.model.Content
import com.youjf.simplebin.model.Secured
import com.youjf.simplebin.service.ContentService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpEntity
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.multipart.MultipartFile

@Component
class ContentControllerImpl(
    @Autowired val contentService: ContentService,
) : ContentController {
    @Secured
    override fun getContentBrowser() = contentService.getLatestContent()?.let {
        contentService.getRawBody(it)
    } ?: ResponseEntity.notFound().build()

    @Secured
    override fun getContentLatest() = contentService.getLatestContent()?.let {
        contentService.getContentBody(it)
    } ?: ResponseEntity.notFound().build()

    @Secured
    override fun getContentJson() = getContentLatest()

    @Secured
    override fun getContentPlain(): HttpEntity<ByteArray> = contentService.getLatestContent()?.let {
        contentService.getPlainBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun getContentById(id: String) = contentService.getContent(id)?.let {
        contentService.getRawBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun getContentJsonById(id: String): HttpEntity<Content> = contentService.getContent(id)?.let {
        contentService.getContentBody(it)
    } ?: ResponseEntity.notFound().build()

    @Secured
    override fun createContent(
        @AuthHeader authHeader: String?,
        request: String,
    ) = contentService.createContent(request)

    @Secured
    override fun createContentFile(
        @AuthHeader authHeader: String?,
        file: MultipartFile,
    ) = contentService.createContentFile(file)
}
