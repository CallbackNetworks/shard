"""What of an integration's configuration may leave the server (ADR-0063).

The sibling of ``node_data`` (ADR-0059), for the same reason and against the same defect.
There the credentials hid in ``Node.data``; here they sit in ``Integration.secret``, and in
two free-form JSON columns, ``auth_config`` and ``custom_headers``. An integration's whole
job is to authenticate to somebody else's endpoint, so its configuration *is* credentials:
an HMAC signing key, a basic-auth password, an API-key header value, and whatever the user
typed into a custom header — which, for an outbound webhook, is most often a token.

``IntegrationOut`` served all of it verbatim. ADR-0059 swept ``Node.data`` because
free-form JSON has no schema and so appears nowhere in the OpenAPI contract; a typed
response model was assumed to be self-describing and was not looked at. It described these
fields accurately. That was the problem: it described them, and then served them.

Two rules, and they are the same rule read from each end:

* **Reading never yields a credential.** A value that is set but withheld reads as ``None``
  *with its key present*. Stored header values are always strings, so a null value cannot
  be confused with a stored one — key absent means unset, key present and null means set
  and hidden.
* **Writing back what you read changes nothing.** Because a withheld value reads as
  ``None``, "keep what is stored" is what ``None`` must mean on the way in. A client that
  GETs an integration, edits the username and PATCHes it back therefore cannot silently
  destroy the password it was never shown. That safety is here on the server rather than in
  the form, because a rule that lives in one hand-written client is a rule the next client
  is written without.

To clear a credential, send an empty string. To remove a custom header, leave its key out.
"""

# Keys of ``auth_config`` that carry a credential. The rest of that dict — ``username``,
# ``header_name`` — is configuration the user must be able to see in order to edit it.
AUTH_SECRET_KEYS = ("password", "header_value")


def public_auth_config(auth_config: dict | None) -> dict | None:
    """``auth_config`` with its credential values withheld but their presence visible."""
    if not auth_config:
        return auth_config
    return {k: (None if k in AUTH_SECRET_KEYS and v else v) for k, v in auth_config.items()}


def public_custom_headers(custom_headers: dict | None) -> dict | None:
    """``custom_headers`` with every value withheld.

    Unlike ``auth_config`` there is no key list to consult: the names are the user's own and
    carry no meaning we can act on. ``X-Environment: production`` is not a secret and
    ``X-Api-Token: ...`` is, and nothing here can tell them apart — so both are withheld.
    Retyping a header value is the cost; the alternative cost is serving a token.
    """
    if not custom_headers:
        return custom_headers
    return dict.fromkeys(custom_headers)


def merge_secret_dict(stored: dict | None, incoming: dict | None) -> dict | None:
    """Apply an incoming credential dict over the stored one, ``None`` meaning "unchanged".

    Used for both ``auth_config`` and ``custom_headers``: keys the client did not send are
    dropped (that is how a header is removed), keys sent as ``None`` keep their stored value
    (that is how the redacted read round-trips), and anything else is written through —
    including ``""``, which is how a credential is deliberately cleared.
    """
    if incoming is None:
        return stored
    stored = stored or {}
    return {k: (stored.get(k) if v is None else v) for k, v in incoming.items()}
