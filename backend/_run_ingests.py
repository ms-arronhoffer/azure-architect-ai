import asyncio
from db import init_db
from services.refarch_ingest import run_ingest as refarch_run
from services.demo_ingest import run_ingest as demo_run


async def main():
    await init_db()
    print("REFARCH:", await refarch_run())
    print("DEMOS:", await demo_run())


asyncio.run(main())
