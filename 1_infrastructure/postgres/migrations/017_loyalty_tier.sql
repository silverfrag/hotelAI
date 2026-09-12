ALTER TABLE customers ADD COLUMN loyalty_tier VARCHAR(20) NOT NULL DEFAULT 'Bronze';
ALTER TABLE customers ADD COLUMN loyalty_points INT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD CONSTRAINT customers_loyalty_tier_check CHECK (loyalty_tier IN ('Bronze', 'Silver', 'Gold', 'Platinum'));
