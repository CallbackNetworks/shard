"""One ``Content-Disposition``, for every door that hands over a file.

HTTP header values are latin-1, so a filename carrying anything outside it raises at
*response* time — the endpoint answers 500 with the body already computed and nothing in
the log naming the filename as the cause. Every download this product offers names its
file after text a person wrote: a decision record is titled by whoever recorded it, an
attachment keeps the name it was uploaded under. On an instance whose records are written
in Chinese that means ``GET /decisions/{id}/export`` had never once succeeded — 79 records
stored, one of them (the only ASCII-titled one) exportable.

Starlette's ``FileResponse`` already solves this (RFC 6266: percent-encode into
``filename*``), which is exactly why the SPA's attachment download worked while its
``/api/v1`` twin — a hand-built ``Response`` with a hand-built header — did not. This is
that rule, in one place, so the two doors onto one download cannot disagree again
(ADR-0085).
"""

from urllib.parse import quote


def attachment_headers(filename: str) -> dict[str, str]:
    """``Content-Disposition: attachment`` for ``filename``, whatever is in it."""
    quoted = quote(filename)
    if quoted != filename:
        return {"Content-Disposition": f"attachment; filename*=utf-8''{quoted}"}
    return {"Content-Disposition": f'attachment; filename="{filename}"'}
