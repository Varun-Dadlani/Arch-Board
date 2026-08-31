import io
import json
import zipfile
from typing import Any


def _technologies(document: dict[str, Any]) -> set[str]:
    return {
        node.get("data", {}).get("technology")
        for node in document.get("nodes", [])
        if node.get("data", {}).get("technology")
    }


def generate_boilerplate(name: str, document: dict[str, Any]) -> dict[str, Any]:
    technologies = _technologies(document)
    project_name = "-".join(name.lower().split()) or "architecture-starter"
    files: dict[str, Any] = {
        "README.md": f"# {name}\n\nGenerated starter project from ARCH-BOARD.\n",
        ".gitignore": "__pycache__/\n.env\nnode_modules/\n",
    }

    if "react" in technologies:
        files["frontend/src/App.jsx"] = """import './styles.css'\n\nexport default function App() {\n  return <main><h1>Architecture starter</h1></main>\n}\n"""
        files["frontend/package.json"] = """{\n  \"private\": true,\n  \"scripts\": {\"dev\": \"vite\"},\n  \"dependencies\": {\"@vitejs/plugin-react\": \"latest\", \"vite\": \"latest\", \"react\": \"latest\", \"react-dom\": \"latest\"}\n}\n"""

    if "angular" in technologies:
        files["frontend/src/app/app.component.ts"] = """import { Component } from '@angular/core';\n\n@Component({\n  selector: 'app-root',\n  template: '<main><h1>Architecture starter</h1></main>',\n})\nexport class AppComponent {}\n"""
        files["frontend/package.json"] = """{\n  \"private\": true,\n  \"scripts\": {\"start\": \"ng serve\"},\n  \"dependencies\": {\"@angular/core\": \"latest\", \"@angular/platform-browser\": \"latest\"},\n  \"devDependencies\": {\"@angular/cli\": \"latest\", \"typescript\": \"latest\"}\n}\n"""

    if "vue" in technologies:
        files["frontend/src/App.vue"] = """<script setup>\n</script>\n\n<template>\n  <main><h1>Architecture starter</h1></main>\n</template>\n"""
        files["frontend/package.json"] = """{\n  \"private\": true,\n  \"scripts\": {\"dev\": \"vite\"},\n  \"dependencies\": {\"vue\": \"latest\", \"vite\": \"latest\", \"@vitejs/plugin-vue\": \"latest\"}\n}\n"""

    if "fastapi" in technologies:
        files["backend/app/main.py"] = """from fastapi import FastAPI\n\napp = FastAPI(title=\"Architecture starter\")\n\n@app.get(\"/health\")\ndef health() -> dict[str, str]:\n    return {\"status\": \"ok\"}\n"""
        files["backend/requirements.txt"] = "fastapi\nuvicorn[standard]\n"
    elif "django" in technologies:
        files["backend/manage.py"] = """#!/usr/bin/env python\nimport os\n\nif __name__ == '__main__':\n    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')\n    from django.core.management import execute_from_command_line\n    execute_from_command_line()\n"""
        files["backend/requirements.txt"] = "Django\ndjango-cors-headers\n"
        files["backend/config/settings.py"] = """SECRET_KEY = 'change-me-in-env'\nDEBUG = True\nROOT_URLCONF = 'config.urls'\n"""
    elif "spring-boot" in technologies:
        files["backend/src/main/java/com/example/Application.java"] = """package com.example;\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class Application {\n    public static void main(String[] args) {\n        SpringApplication.run(Application.class, args);\n    }\n}\n"""
        files["backend/pom.xml"] = """<project xmlns=\"http://maven.apache.org/POM/4.0.0\">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.example</groupId><artifactId>architecture-starter</artifactId><version>0.0.1</version>\n  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.4.0</version></parent>\n  <dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies>\n</project>\n"""
    elif "express" in technologies:
        files["backend/server.js"] = """const express = require('express')\n\nconst app = express()\napp.get('/health', (_request, response) => response.json({ status: 'ok' }))\napp.listen(3000, () => console.log('API listening on 3000'))\n"""
        files["backend/package.json"] = """{\n  \"private\": true,\n  \"scripts\": {\"start\": \"node server.js\"},\n  \"dependencies\": {\"express\": \"latest\"}\n}\n"""

    database = next((value for value in ("postgresql", "mysql", "mongodb") if value in technologies), None)
    if database:
        database_image = {"postgresql": "postgres:16", "mysql": "mysql:8", "mongodb": "mongo:7"}[database]
        database_port = {"postgresql": "5432", "mysql": "3306", "mongodb": "27017"}[database]
        files[".env.example"] = f"DATABASE_URL=<{database}-connection-string>\n"
        files["docker-compose.yml"] = f"""services:\n  database:\n    image: {database_image}\n    ports:\n      - \"{database_port}:{database_port}\"\n"""

    if "redis" in technologies:
        files["infra/redis.md"] = "# Redis\n\nUse Redis for caching, sessions, or realtime fan-out.\n"

    if "rabbitmq" in technologies:
        files["infra/rabbitmq.md"] = "# RabbitMQ\n\nUse RabbitMQ for asynchronous events and background jobs.\n"
        files["docker-compose.rabbitmq.yml"] = """services:\n  rabbitmq:\n    image: rabbitmq:3-management\n    ports:\n      - \"5672:5672\"\n      - \"15672:15672\"\n"""

    if "object-storage" in technologies:
        files["infra/object-storage.md"] = "# Object Storage\n\nConfigure a bucket and credentials through environment variables.\n"
        files[".env.example"] = files.get(".env.example", "") + "OBJECT_STORAGE_BUCKET=architecture-starter\n"

    files["architecture.json"] = document
    return {"project_name": project_name, "technologies": sorted(technologies), "files": files}


def create_boilerplate_zip(name: str, document: dict[str, Any]) -> tuple[str, io.BytesIO]:
    bundle = generate_boilerplate(name, document)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for path, content in bundle["files"].items():
            if isinstance(content, (dict, list)):
                content = json.dumps(content, indent=2) + "\n"
            output.writestr(f"{bundle['project_name']}/{path}", content)
    archive.seek(0)
    return bundle["project_name"], archive
