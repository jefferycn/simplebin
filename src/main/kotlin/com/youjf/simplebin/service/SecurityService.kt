package com.youjf.simplebin.service

import com.youjf.simplebin.config.AppConfig
import com.youjf.simplebin.model.Secured
import org.aspectj.lang.ProceedingJoinPoint
import org.aspectj.lang.annotation.Around
import org.aspectj.lang.annotation.Aspect
import org.aspectj.lang.annotation.Pointcut
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Service
import org.springframework.util.StringUtils

@Aspect
@Service
class SecurityService(
    @Autowired val properties: AppConfig
) {
    @Around("securedWithToken(secured, authHeader)")
    fun permissionValidator(call: ProceedingJoinPoint, secured: Secured, authHeader: String?): Any =
        if (properties.token.isNotEmpty()) {
            getAuthorizationWithoutBearer(authHeader)?.let { authToken ->
                if (authToken != properties.token) {
                    ResponseEntity<ByteArray>(
                        HttpHeaders(),
                        HttpStatus.UNAUTHORIZED
                    )
                } else call.proceed()
            } ?: ResponseEntity<ByteArray>(
                HttpHeaders(),
                HttpStatus.UNAUTHORIZED
            )
        } else call.proceed()

    private fun getAuthorizationWithoutBearer(authHeader: String?) = if (StringUtils.startsWithIgnoreCase(
            authHeader,
            "Bearer "
        )
    ) authHeader?.substring("Bearer ".length) else authHeader

    @Pointcut("@annotation(secured) && args(authHeader,..)", argNames = "secured")
    fun securedWithToken(secured: Secured, authHeader: String?) {
        // The aspect Pointcut
    }
}
