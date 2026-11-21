package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/gin-gonic/gin"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/api"
)

// validateRequest applies the contract before the generated strict handler decodes DTOs.
func validateRequest(router routers.Router) gin.HandlerFunc {
	return func(c *gin.Context) {
		route, params, err := router.FindRoute(c.Request)
		if err == nil && route.Path == "/api/meeting-types/{meetingTypeId}/slots" && c.Request.URL.Query().Has("date") {
			if _, dateErr := time.Parse(time.DateOnly, c.Query("date")); dateErr != nil {
				c.AbortWithStatusJSON(http.StatusBadRequest, api.ValidationError{Message: "Проверьте дату", Fields: map[string]string{"date": "Введите календарную дату в формате YYYY-MM-DD"}})
				return
			}
		}
		if err == nil && route.Operation.RequestBody != nil {
			body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20))
			if err != nil || !json.Valid(body) {
				c.AbortWithStatusJSON(http.StatusBadRequest, api.ValidationError{Message: "Проверьте запрос", Fields: map[string]string{"body": "Некорректный JSON"}})
				return
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(body))
		}
		if err == nil {
			err = openapi3filter.ValidateRequest(c.Request.Context(), &openapi3filter.RequestValidationInput{
				Request: c.Request, PathParams: params, Route: route,
				Options: &openapi3filter.Options{MultiError: true},
			})
		}
		if err != nil {
			fields := map[string]string{}
			collectFieldErrors(err, fields)
			if len(fields) == 0 {
				fields["body"] = "Проверьте формат запроса и поля формы"
			}
			c.AbortWithStatusJSON(http.StatusBadRequest, api.ValidationError{Message: "Проверьте данные запроса", Fields: fields})
		}
	}
}

func collectFieldErrors(err error, fields map[string]string) {
	var multiple openapi3.MultiError
	if errors.As(err, &multiple) {
		for _, child := range multiple {
			collectFieldErrors(child, fields)
		}
		return
	}
	var e *openapi3.SchemaError
	if errors.As(err, &e) {
		path := e.JSONPointer()
		if len(path) > 0 && (path[0] == "name" || path[0] == "description" || path[0] == "durationMinutes" || path[0] == "guestName" || path[0] == "guestEmail" || path[0] == "start" || path[0] == "attemptId") {
			fields[path[0]] = "Проверьте значение поля"
		} else if e.SchemaField == "required" {
			if value, ok := e.Value.(map[string]any); ok {
				for _, name := range e.Schema.Required {
					if _, exists := value[name]; !exists {
						fields[name] = "Заполните обязательное поле"
					}
				}
			}
		}
	}
}
