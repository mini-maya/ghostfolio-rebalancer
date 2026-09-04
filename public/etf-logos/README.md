# ETF-Anbieter-Logos

Lege hier die SVG-Logos der ETF-Anbieter ab. Die Dateien werden von der
`EtfProviderLogo`-Komponente (`src/app/shared/etf-provider-logo/`) automatisch
geladen und mit einer Kreismaske dargestellt.

Erwartete Dateinamen (genau so benennen):

- `vanguard.svg`
- `ishares.svg`
- `state-street.svg`
- `placeholder.svg` – Fallback, falls der Anbieter einer Position nicht
  erkannt wird

Die Zuordnung erfolgt über den Positionsnamen (z. B. "Vanguard FTSE
All-World", "iShares MSCI World", "SPDR MSCI World" / "State Street ...").
