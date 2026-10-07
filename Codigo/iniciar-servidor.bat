@echo off
setlocal enabledelayedexpansion
title NexuStock - Servidor local

REM Levanta el entorno de NexuStock:
REM   - Docker Compose: PostgreSQL (nexustock-db) + backend Express (nexustock-backend)
REM   - Frontend Next.js en local (npm run dev) en una ventana aparte
REM Abre la pagina en el navegador cuando esta lista.
REM Uso: doble clic sobre este archivo.

REM Trabajar siempre desde la carpeta del proyecto, sin importar desde donde se ejecute
cd /d "%~dp0"

echo ==========================================
echo   NexuStock - iniciando servidor
echo ==========================================
echo.

REM --- 1. Verificar el .env de la raiz ---
if exist ".env" goto env_listo
if not exist ".env.example" (
    echo [ERROR] No existen .env ni .env.example en la carpeta del proyecto.
    echo.
    pause
    exit /b 1
)
copy ".env.example" ".env" >nul
echo [OK] No habia .env: se creo a partir de .env.example.
:env_listo

REM Leer los puertos desde .env (con valores por defecto si no estan definidos)
set "FRONTEND_PORT=3001"
set "BACKEND_PORT=4000"
set "DB_PORT=5433"
for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
    if /i "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
    if /i "%%A"=="DB_PORT" set "DB_PORT=%%B"
)
set "FRONTEND_URL=http://localhost:!FRONTEND_PORT!"
set "BACKEND_URL=http://localhost:!BACKEND_PORT!"

REM --- 2. Verificar que Docker este instalado ---
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] No se encontro el comando "docker".
    echo         Instala Docker Desktop: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

REM --- 3. Verificar que el motor de Docker este corriendo (y arrancarlo si no) ---
REM Las pausas usan "ping" en vez de "timeout": timeout falla si la entrada
REM esta redirigida (p. ej. al lanzarlo desde otra consola o herramienta).
REM El loop de espera va fuera de cualquier bloque ( ): cmd no parsea
REM etiquetas :label dentro de parentesis.
docker info >nul 2>&1
if not errorlevel 1 goto docker_listo

echo [..] Docker Desktop no esta corriendo. Intentando iniciarlo...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" >nul 2>&1
set /a INTENTOS=0

:esperar_docker
ping -n 6 127.0.0.1 >nul
set /a INTENTOS+=1
docker info >nul 2>&1
if not errorlevel 1 goto docker_listo
if !INTENTOS! lss 36 goto seguir_esperando_docker
echo.
echo [ERROR] Docker Desktop no respondio despues de 3 minutos.
echo         Abrelo manualmente, espera a que diga "Engine running" y
echo         vuelve a ejecutar este archivo.
echo.
pause
exit /b 1

:seguir_esperando_docker
echo     esperando al motor de Docker... !INTENTOS!/36
goto esperar_docker

:docker_listo
echo [OK] Motor de Docker disponible.
echo.

REM --- 4. Levantar los contenedores (db + backend) ---
REM -V renueva el volumen anonimo de node_modules del backend para que tome las dependencias nuevas.
echo [..] Levantando contenedores (db, backend)...
echo      La primera vez puede tardar varios minutos: construye las imagenes.
echo.
docker compose up -d --build -V
if errorlevel 1 (
    echo.
    echo [ERROR] "docker compose up -d --build" fallo. Revisa el mensaje de arriba.
    echo         Si el error dice "port is already allocated", cambia DB_PORT o
    echo         BACKEND_PORT en el archivo .env.
    echo.
    pause
    exit /b 1
)
echo.
echo [OK] Contenedores iniciados.
echo.

REM --- 5. Esperar a que el backend responda ---
echo [..] Esperando a que el backend responda en !BACKEND_URL!/api/health ...
set /a ESPERA=0

:esperar_api
curl.exe -s -f -o NUL !BACKEND_URL!/api/health >nul 2>&1
if not errorlevel 1 goto api_lista
set /a ESPERA+=1
if !ESPERA! geq 30 goto api_no_responde
ping -n 3 127.0.0.1 >nul
goto esperar_api

:api_no_responde
echo [AVISO] El backend no respondio en 1 minuto. Revisa los logs con:
echo         docker compose logs -f backend
echo.
goto frontend

:api_lista
echo [OK] Backend listo.
echo.

:frontend
REM --- 6. Iniciar el frontend (Next.js) en una ventana aparte ---
where npm >nul 2>&1
if errorlevel 1 (
    echo [AVISO] No se encontro "npm": no se puede iniciar el frontend.
    echo         Instala Node.js LTS: https://nodejs.org/
    echo.
    goto resumen
)

if not exist "frontend\node_modules" (
    echo [..] Instalando dependencias del frontend (solo la primera vez^)...
    pushd frontend
    call npm install
    popd
    echo.
)

REM Si el puerto ya esta en uso: o es el frontend de NexuStock ya corriendo
REM (se reutiliza) o es otra aplicacion (se avisa, en vez de abrir la pagina equivocada).
netstat -ano | findstr /r /c:":!FRONTEND_PORT! .*LISTENING" >nul 2>&1
if errorlevel 1 goto iniciar_web
curl.exe -s -L !FRONTEND_URL! 2>nul | findstr /c:"NexuStock" >nul 2>&1
if not errorlevel 1 (
    echo [OK] El frontend de NexuStock ya estaba corriendo en !FRONTEND_URL!.
    echo.
    goto abrir
)
echo [ERROR] El puerto !FRONTEND_PORT! esta ocupado por otra aplicacion.
echo         Cambia FRONTEND_PORT en el archivo .env por un puerto libre
echo         y vuelve a ejecutar este archivo.
echo.
goto resumen

:iniciar_web
echo [..] Iniciando el frontend en una ventana nueva (puerto !FRONTEND_PORT!^)...
start "NexuStock - Frontend" /D "%~dp0frontend" cmd /k npm run dev -- -p !FRONTEND_PORT!

echo [..] Esperando a que el frontend responda en !FRONTEND_URL! ...
set /a ESPERA=0

:esperar_web
REM Se valida que responda NexuStock (y no otra app) antes de abrir el navegador
curl.exe -s -L !FRONTEND_URL! 2>nul | findstr /c:"NexuStock" >nul 2>&1
if not errorlevel 1 goto web_lista
set /a ESPERA+=1
if !ESPERA! geq 60 goto web_no_responde
ping -n 3 127.0.0.1 >nul
goto esperar_web

:web_no_responde
echo [AVISO] El frontend no respondio en 2 minutos.
echo         Revisa la ventana "NexuStock - Frontend".
echo.
goto abrir

:web_lista
echo [OK] Frontend listo.
echo.

:abrir
REM --- 7. Abrir la pagina ---
start "" !FRONTEND_URL!

:resumen
echo ==========================================
echo   Frontend : !FRONTEND_URL!
echo   Backend  : !BACKEND_URL!  (health: /api/health)
echo   Postgres : localhost:!DB_PORT!  (ver credenciales en .env)
echo ==========================================
echo.
echo Comandos utiles:
echo   Ver logs en vivo  : docker compose logs -f
echo   Apagar el server  : docker compose down   (y cerrar la ventana del frontend)
echo   Reiniciar la BD   : docker compose down -v  (borra datos y vuelve a ejecutar init.sql)
echo.
pause
endlocal
