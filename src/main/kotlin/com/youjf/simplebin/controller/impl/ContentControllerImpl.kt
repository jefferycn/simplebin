package com.youjf.simplebin.controller.impl

import com.youjf.simplebin.controller.ContentController
import com.youjf.simplebin.model.Content
import com.youjf.simplebin.service.ContentService
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpEntity
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.multipart.MultipartFile

@Component
class ContentControllerImpl(
    @Autowired val contentService: ContentService
) : ContentController {
    override fun getContentBrowser() = contentService.getLatestContent()?.let {
        contentService.getRawBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun getContent() = contentService.getLatestContent()?.let {
        contentService.getContentBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun getContentBrowserJson() = getContent()

    override fun getContent(id: String): HttpEntity<Content> = contentService.getContent(id)?.let {
        contentService.getContentBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun getContentPlain(): HttpEntity<ByteArray> = contentService.getLatestContent()?.let {
        contentService.getPlainBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun getContentRaw(id: String) = contentService.getContent(id)?.let {
        contentService.getRawBody(it)
    } ?: ResponseEntity.notFound().build()

    override fun createContent(request: String) = contentService.createContent(request)
    override fun createContentFile(file: MultipartFile) = contentService.createContentFile(file)
}
