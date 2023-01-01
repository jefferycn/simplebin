package com.youjf.simplebin.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration

@Configuration
@ConfigurationProperties("simplebin")
@EnableConfigurationProperties
class AppConfig(
    var path: String = ""
)
