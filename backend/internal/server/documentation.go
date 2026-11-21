package server

import (
	"bytes"
	"encoding/json"
	"html/template"

	"github.com/getkin/kin-openapi/openapi3"
)

func renderDocumentation(spec *openapi3.T) ([]byte, error) {
	page, err := template.New("documentation").Funcs(template.FuncMap{
		"json": func(value any) (string, error) {
			data, err := json.MarshalIndent(value, "", "  ")
			return string(data), err
		},
	}).Parse(documentation)
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	if err := page.Execute(&output, spec); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

const documentation = `<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Info.Title}} — API</title>
<style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 24px;background:#0c0d11;color:#f1f2f6}a{color:#91aaff}pre{overflow:auto;padding:20px;background:#191c25}code{overflow-wrap:anywhere}article{margin:40px 0}h2{overflow-wrap:anywhere}</style>
<h1>{{.Info.Title}} — API</h1>
<p>Версия {{.Info.Version}}</p>
<p>{{.Info.Description}}</p>
<p>Контракт: <a href="/openapi.json">OpenAPI JSON</a> · <a href="/openapi.yaml">OpenAPI YAML</a></p>
{{range $path, $item := .Paths.Map}}{{range $method, $operation := $item.Operations}}
<article>
<h2>{{$method}} {{$path}}</h2>
<h3>{{$operation.Summary}}</h3>
<p>{{$operation.Description}}</p>
{{with $operation.RequestBody}}<h3>Тело запроса</h3>
<p>{{.Value.Description}}</p>
{{if .Value.Required}}<p>Обязательно.</p>{{end}}
{{template "content" .Value.Content}}{{end}}
<h3>Ответы</h3>
{{range $status, $response := $operation.Responses.Map}}
<h4>{{$status}} — {{$response.Value.Description}}</h4>
{{template "content" $response.Value.Content}}
{{end}}
</article>
{{end}}{{end}}
<h2>Схемы данных</h2>
<p>Обязательные поля указаны в required, допустимые значения — в enum, ограничения длины — в minLength и maxLength.</p>
{{range $name, $schema := .Components.Schemas}}
<section id="/components/schemas/{{$name}}"><h3>{{$name}}</h3><pre><code>{{json $schema.Value}}</code></pre></section>
{{end}}
</html>
{{define "content"}}{{range $type, $media := .}}<p><code>{{$type}}</code></p>
{{with $media.Schema}}{{if .Ref}}<p>Схема: <a href="{{.Ref}}">{{.Ref}}</a></p>{{else}}<pre><code>{{json .}}</code></pre>{{end}}{{end}}
{{end}}{{end}}`
