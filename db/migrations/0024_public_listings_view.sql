-- S21: the only thing public search may read. It exposes safe columns only (no organisation, no exact address, no map point,
-- no unit label) and only listings that are published, confirmed within the last 21 days, complete in all five costs,
-- and whose unit and property are not archived. So even if the hiding job were late, nothing stale can appear.
-- security_invoker: it is read with the caller's own rights, never with the rights of the view's owner.
CREATE OR REPLACE VIEW supply.public_listings WITH (security_invoker = true) AS
SELECT l.id,
       p.name AS property_name,
       n.id   AS node_id,
       n.name AS area,
       u.bedrooms,
       u.floor,
       c.rent, c.deposit, c.utility_deposit, c.service_charge, c.agent_fee,
       (c.rent + c.deposit + c.utility_deposit + c.service_charge + c.agent_fee) AS total_move_in,
       l.last_confirmed_at,
       (SELECT max(b.expires_at) FROM verification.badges b
         WHERE b.subject_type = 'property' AND b.subject_id = p.id AND b.level = 't1_documented'
           AND b.revoked_at IS NULL AND b.expires_at > now()) AS verified_until
  FROM supply.listings l
  JOIN supply.units u ON u.id = l.unit_id AND u.archived_at IS NULL
  JOIN supply.properties p ON p.id = u.property_id AND p.archived_at IS NULL
  LEFT JOIN supply.nodes n ON n.id = p.node_id
  CROSS JOIN LATERAL (
    SELECT max(amount_minor) FILTER (WHERE cost_type = 'rent') / 100                AS rent,
           max(amount_minor) FILTER (WHERE cost_type = 'deposit') / 100             AS deposit,
           max(amount_minor) FILTER (WHERE cost_type = 'utility_deposit') / 100     AS utility_deposit,
           max(amount_minor) FILTER (WHERE cost_type = 'service_charge') / 100      AS service_charge,
           max(amount_minor) FILTER (WHERE cost_type = 'agent_fee') / 100           AS agent_fee
      FROM supply.listing_costs WHERE listing_id = l.id) c
 WHERE l.status = 'published'
   AND l.last_confirmed_at > now() - interval '21 days'
   AND c.rent IS NOT NULL AND c.deposit IS NOT NULL AND c.utility_deposit IS NOT NULL AND c.service_charge IS NOT NULL AND c.agent_fee IS NOT NULL;
