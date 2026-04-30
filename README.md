# Traducción al Español (España) de Star Citizen
### Traducción comunitaria del global.ini para **Star Citizen**

# ¿Qué es esto?
Esta es una traducción al **español de España** basada en el excelente trabajo de mejoras que realiza [MrKraken](https://github.com/MrKraken/StarStrings) sobre el `global.ini` oficial del juego.

MrKraken mejora y corrige el fichero original en inglés (contratos, descripciones, misiones...). Este proyecto toma ese trabajo mejorado y lo traduce automáticamente al español, aplicando correcciones manuales adicionales para adaptar la terminología al contexto del juego.

# Incluye
- Traducción al español de todos los textos del juego: misiones, contratos, interfaces, descripciones de objetos, etc.
- Variables del juego (`~mission()`, `~action()`, `%ls`...) preservadas intactas — el juego las interpreta correctamente
- Nombres de lugares (`RR_*`), vehículos (`vehicle_name*`) y bases abandonadas (`FOB_Abandoned_*`) mantenidos en inglés para evitar confusiones
- Correcciones manuales de terminología específica del juego
- Terminología minera corregida: `(Ore)`, `(Raw)` en lugar de traducciones literales incorrectas

# Instalación
1. Descarga la última release en el panel derecho de este repositorio
2. Copia la carpeta `Data` en la carpeta raíz de tu instalación de Star Citizen (LIVE o PTU)
3. Si no tienes un fichero `user.cfg`, créalo en la carpeta raíz con el siguiente contenido:
   ```
   g_language = spanish_(spain)
   ```
   Si ya tienes un `user.cfg`, añade esa línea al final sin sobreescribir el resto.
4. ¡Lanza el juego!

```
StarCitizen/
└── LIVE/
    ├── user.cfg
    └── Data/
        └── Localization/
            └── spanish_(spain)/
                └── global.ini
```

> [!WARNING]
> Es necesario mantener este fichero actualizado con cada nueva versión del juego. Las releases se generan automáticamente cuando se procesa una nueva versión del `global.ini` de MrKraken.

> [!NOTE]
> La traducción se realiza con Google Translate como base, con correcciones manuales adicionales. Si encuentras errores, repórtalos en la pestaña **Issues**.

> [!IMPORTANT]
> **Proyecto de la comunidad** — Este es un proyecto fan no oficial de Star Citizen, sin afiliación con Cloud Imperium Games. La capacidad de personalizar la localización mediante el fichero `global.ini` está autorizada por CIG para apoyar las traducciones comunitarias.
> - [Star Citizen: Community Localization Update](https://robertsspaceindustries.com/spectrum/community/SC/forum/1/thread/star-citizen-community-localization-update) (2023-10-11)
> - [RSI Terms of Service](https://robertsspaceindustries.com/en/tos)
> - [Translation & Fan Localization Statement](https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793)

# Créditos
- [MrKraken](https://github.com/MrKraken/StarStrings) — por las mejoras sobre el fichero original en inglés que sirven de base para esta traducción
- [ExoAE](https://github.com/ExoAE/ScCompLangPack) — por la idea original del Language Pack comunitario
