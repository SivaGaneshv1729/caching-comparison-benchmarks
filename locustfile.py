import random
from locust import HttpUser, task, between

class CacheComparisonUser(HttpUser):
    # Simulate thinking time between requests
    wait_time = between(0.1, 0.5)

    def on_start(self):
        # Assign a random unique user ID to each virtual user for rate limit tracking
        self.user_id = f"user_{random.randint(1000, 9999)}"
        # Alternate headers to evenly distribute test traffic across both backends
        self.backend = random.choice(["redis", "memcached"])
        self.headers = {
            "X-User-Id": self.user_id,
            "X-Cache-Backend": self.backend
        }

    @task(6)
    def view_product(self):
        # 90% read traffic simulation: view products with Zipf/Gaussian style focus on lower IDs
        product_id = random.randint(1, 100000)
        self.client.get(f"/products/{product_id}", headers=self.headers, name="/products/:id")

    @task(2)
    def view_product_and_record(self):
        # Simulates a user looking at a product and triggering a leaderboard counter increment
        product_id = random.randint(1, 1000) # limit to top 1000 products for high contention views
        self.client.post(f"/products/{product_id}/view", headers=self.headers, name="/products/:id/view")

    @task(1)
    def check_leaderboard(self):
        self.client.get("/leaderboard", headers=self.headers, name="/leaderboard")

    @task(1)
    def manage_session(self):
        session_id = f"sess_{self.user_id}"
        # Fetch session
        self.client.get(f"/session/{session_id}", headers=self.headers, name="/session/:id")
        # Update field in session
        self.client.post(
            f"/session/{session_id}",
            json={"field": "last_login", "value": "2026-06-10T21:30:00Z"},
            headers=self.headers,
            name="/session/:id"
        )
