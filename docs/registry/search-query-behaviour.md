# Registry company search — query behaviour

The public **/registry/search** page and the underlying
`registry-company-search` edge function support partial matching across
several fields, so users do **not** need to type a company's exact name.

## Tokens that are matched

A query is normalised (lower-cased, punctuation stripped) and matched
against:

- Company name, trading name, previous name
- Registration number (e.g. `RC-702207`, `B2005147126`, `K2013065738`)
- Local number
- VAT / tax number (e.g. `9404913155`)
- Registered address tokens (street, suburb, city, postcode)
- Legal form (`Ltd`, `Pty`, `CC`, `PLC`, `Sole proprietor`, …)
- Country code (`ZA`, `NG`)
- Public officer / director display names
- Public activity summaries

So `starf` finds **Starfair 162**, `7022` finds **Dangote Fertiliser
Limited** (registration `RC-702207`), and `grayston` finds **Laurium
Capital** through its registered address.

## Country filter

The country filter on the search form (and the `country_code` field on
the API) restricts results to a single jurisdiction. We currently demo
two countries:

- `ZA` — South Africa
- `NG` — Nigeria

## Match-reason highlights

Each result row carries a `match_reasons` array. The UI renders these as
"Matched on" chips showing the field and the value that matched (e.g.
`Registration number: B2005147126`). The API exposes the same payload
shape:

```json
{
  "company_name": "Starfair 162",
  "match_reasons": [
    { "field_label": "Company name", "value_raw": "Starfair 162" },
    { "field_label": "Registration number", "value_raw": "B2005147126" }
  ]
}
```

## What is **not** returned to public callers

- Raw bank account details
- Personal email, phone, residential addresses
- Admin-only raw source documents and internal confidence notes

These are suppressed at the database (column-level grants) and at the
edge function (admin-only match-reason rows are never echoed to public
callers).
