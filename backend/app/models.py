from enum import StrEnum
import ipaddress
import re
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Provider(StrEnum):
    openai = "openai"
    perplexity = "perplexity"


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def public_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").encode("idna").decode("ascii").lower()
        port = parts.port
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Enter a valid public HTTPS URL") from exc
    if parts.scheme != "https" or not host or parts.username or parts.password or port not in (None, 443):
        raise ValueError("Use a public HTTPS URL without credentials or a custom port")
    if host == "localhost" or "." not in host or host.endswith((".local", ".localhost", ".internal")):
        raise ValueError("Local and private addresses are not allowed")
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("Local and private addresses are not allowed")
    if re.search(r"[\x00-\x20\x7f\\]", value):
        raise ValueError("Invalid URL characters")
    return urlunsplit(("https", host, parts.path or "/", parts.query, ""))


class AuditRequest(InputModel):
    brand: str = Field(min_length=2, max_length=80)
    target_url: str = Field(max_length=2048)
    offering: str = Field(default="", max_length=120)
    prompts: list[str] = Field(min_length=1, max_length=10)
    mode: str = Field(default="live", pattern="^(demo|live)$")
    providers: list[Provider] = Field(default_factory=lambda: list(Provider), min_length=1, max_length=2)

    _url = field_validator("target_url")(public_url)

    @field_validator("prompts")
    @classmethod
    def clean_list(cls, values: list[str]) -> list[str]:
        values = [v.strip() for v in values]
        if any(not v or len(v) > 500 for v in values):
            raise ValueError("Entries must contain 1–500 characters")
        if len({v.casefold() for v in values}) != len(values):
            raise ValueError("Remove duplicate entries")
        return values

    @model_validator(mode="after")
    def distinct_providers(self):
        if len(set(self.providers)) != len(self.providers):
            raise ValueError("Select each provider only once")
        return self


class BrandMention(InputModel):
    brand_name: str = Field(min_length=1, max_length=100)
    rank_position: int | None = Field(default=None, ge=1, le=100)
    sentiment: str = Field(default="neutral", pattern="^(positive|neutral|negative)$")
    evidence: str = Field(min_length=1, max_length=1000)
    reason_for_inclusion: str = Field(max_length=1000)


class ExtractedAnswer(InputModel):
    answer: str = Field(min_length=1, max_length=40000)
    mentions: list[BrandMention] = Field(max_length=30)
    structural_winner_patterns: list[str] = Field(default_factory=list, max_length=10)
    generic_buyer_question: bool | None = None


class QueryResult(BaseModel):
    query_id: str
    prompt_index: int
    provider: Provider
    status: str
    mode: str
    answer: str = ""
    mentions: list[BrandMention] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)
    structural_winner_patterns: list[str] = Field(default_factory=list)
    generic_buyer_question: bool | None = None
    error: str | None = None
    access_error: bool = False
    skipped: bool = False


class OptimizationRequest(InputModel):
    brand: str = Field(min_length=2, max_length=80)
    target_url: str = Field(max_length=2048)
    page_content: str = Field(default="", max_length=100000)
    redirect_hosts: list[str] = Field(default_factory=list, max_length=5)
    fetch_page: bool = False
    mode: str = Field(default="ai", pattern="^(ai|source)$")
    provider: Provider = Provider.openai
    buyer_question: str = Field(default="", max_length=500)

    _url = field_validator("target_url")(public_url)

    @field_validator("redirect_hosts")
    @classmethod
    def public_redirect_hosts(cls, values):
        if any(not value or len(value) > 253 or re.search(r"[/:@?#*\\\s]", value) for value in values):
            raise ValueError("Enter exact public hostnames without schemes, ports, or paths")
        return list(dict.fromkeys(urlsplit(public_url(f"https://{value}")).hostname for value in values))
