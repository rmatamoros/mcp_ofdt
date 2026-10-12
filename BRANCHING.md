# Branching Strategy

Este repositorio usa una estrategia simple con `main`, `develop` y ramas
funcionales.

## Ramas base

- `main`
  contiene solo codigo final, estable y listo para liberar
- `develop`
  contiene la integracion de trabajo en curso y es la base para nuevas ramas

## Regla general

Todo cambio nuevo debe:

1. salir desde `develop`
2. vivir en una rama funcional propia
3. volver primero a `develop`
4. llegar a `main` solo cuando ya este validado

## Prefijos permitidos

Las ramas funcionales deben usar uno de estos prefijos:

- `feat/`
  nuevas funcionalidades
- `fix/`
  correcciones normales
- `hotfix/`
  correcciones urgentes

## Convencion de nombres

Formato recomendado:

```text
prefijo/descripcion-corta-y-clara
```

Reglas:

- usar todo en minuscula
- usar palabras separadas por guion
- describir el cambio, no el archivo
- evitar nombres genericos como `cambio1`, `ajuste`, `prueba`

## Ejemplos para este proyecto

- `feat/tool-list-catalog-objects`
- `feat/http-user-auth`
- `fix/ords-token-refresh`
- `fix/file-input-size-limit`
- `fix/docker-arm64-build`
- `hotfix/ghcr-publish-tags`

## Flujo de trabajo

### 1. Crear rama funcional desde develop

```powershell
git checkout develop
git pull
git checkout -b fix/ords-token-refresh
```

### 2. Trabajar y confirmar cambios

```powershell
git add .
git commit -m "fix: renovar el token OAuth2 antes de que expire"
```

### 3. Integrar a develop

```powershell
git checkout develop
git merge fix/ords-token-refresh
```

### 4. Promover a main

```powershell
git checkout main
git merge develop
```

## Reglas operativas

- no trabajar directo en `main`
- no iniciar ramas funcionales desde `main`, salvo que el proceso de hotfix del
  equipo lo exija expresamente
- no mezclar varias tareas distintas en una misma rama funcional
- si una tarea toca herramientas, Docker y CI, eso sigue siendo una sola rama
  si pertenece al mismo objetivo funcional

## Proteccion de ramas

### main

Configuracion recomendada:

- exigir pull request antes del merge
- exigir al menos `1` aprobacion
- invalidar aprobaciones previas si entran commits nuevos
- exigir status checks exitosos antes del merge
- exigir rama actualizada antes del merge
- bloquear force push
- impedir borrado

### develop

Configuracion recomendada:

- exigir pull request antes del merge
- exigir al menos `1` aprobacion
- bloquear force push
- impedir borrado

### ramas funcionales

Patrones:

- `feat/*`
- `fix/*`
- `hotfix/*`

Regla:

- no protegerlas
- permitir borrado despues del merge
- crearlas siempre desde `develop`

## Recomendacion para este repo

Cuando el cambio afecte herramientas, imagen Docker y CI al mismo tiempo, el
nombre de la rama debe reflejar el objetivo tecnico principal. Ejemplos:

- `feat/tool-get-form-calls-depth`
- `fix/http-origin-check`

## Versiones de la imagen

- cada merge a `main` publica `ghcr.io/rmatamoros/ofdt-mcp:latest` y
  `sha-<commit>`
- para una version estable, actualizar `version` en `package.json`, fusionar a
  `main` y crear el tag `mcp-vX.Y.Z` sobre ese commit; el workflow rechaza el
  tag si no coincide con `package.json`

```powershell
git checkout main
git pull
git tag mcp-v0.2.0
git push origin mcp-v0.2.0
```
