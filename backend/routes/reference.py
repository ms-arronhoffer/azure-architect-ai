"""
Reference architecture catalog route.
GET  /api/reference-architectures        → list/search catalog
GET  /api/reference-architectures/{id}   → single architecture detail
"""

from fastapi import APIRouter, Query

from data.reference_archs import ALL_TAGS, CATEGORIES, REFERENCE_ARCHS, search_reference_archs

router = APIRouter()


@router.get("/reference-architectures")
async def list_reference_archs(
    q: str = Query("", description="Free-text search"),
    category: str = Query("", description="Filter by category"),
    tag: str = Query("", description="Filter by tag"),
):
    results = search_reference_archs(query=q, category=category, tag=tag)
    return {
        "architectures": results,
        "total": len(results),
        "categories": CATEGORIES,
        "tags": ALL_TAGS,
    }


@router.get("/reference-architectures/{arch_id}")
async def get_reference_arch(arch_id: str):
    match = next((a for a in REFERENCE_ARCHS if a["id"] == arch_id), None)
    if not match:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Architecture not found")
    return match
