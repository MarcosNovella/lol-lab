@echo off
REM ---------------------------------------------------------------------------
REM  lol — abre el panel.
REM
REM  Hacele un acceso directo en el escritorio y doble click cuando terminas de
REM  jugar. Levanta el servidor local y te abre el navegador.
REM
REM  La ventana queda abierta a proposito: mientras este abierta, el panel
REM  funciona. Cerrarla apaga el servidor.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

call pnpm lol ui
set CODIGO=%ERRORLEVEL%

REM Un .bat que se cierra solo ante un error es un .bat que no se puede
REM depurar: el mensaje aparece y desaparece antes de que llegues a leerlo.
REM Ctrl-C (salida 130) es una salida normal y no merece pausa.
if %CODIGO% NEQ 0 if %CODIGO% NEQ 130 (
  echo.
  echo ---------------------------------------------------------------
  echo  Fallo al arrancar. Codigo: %CODIGO%
  echo.
  echo  Lo mas comun:
  echo   - faltan dependencias      ^-^-^>  pnpm install
  echo   - Node muy viejo           ^-^-^>  hace falta 22 o superior
  echo   - no estas en el repo      ^-^-^>  este .bat tiene que vivir en la raiz
  echo.
  echo  Copiame lo que dice arriba y lo miramos.
  echo ---------------------------------------------------------------
  pause
)
