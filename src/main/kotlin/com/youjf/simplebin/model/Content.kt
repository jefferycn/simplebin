package com.youjf.simplebin.model

import com.fasterxml.jackson.annotation.JsonProperty
import org.springframework.hateoas.RepresentationModel

data class Content(
    @field:JsonProperty("id")
    var id: String? = null,

    @field:JsonProperty("type")
    var type: String? = null,

    @field:JsonProperty("body")
    var body: String? = null
) : RepresentationModel<Content>()
