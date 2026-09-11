from redis.asyncio import Redis
from dotenv import load_dotenv
from os import getenv
load_dotenv()


redis=Redis(host=getenv("REDIS_HOST"), 
            port=6379, 
            decode_responses=True
            )


def main():
    redis.set("test_key", "test_value")
    value = redis.get("test_key")
    print(f"Value for 'test_key': {value}")

if __name__ == "__main__":
    main()