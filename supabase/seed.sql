-- =============================================================================
-- StockFlow ERP - demo seed data (Phase 1: master data only)
--
-- All companies, people, addresses and tax ids are fictional.
-- Demo users are created separately with `npm run seed:users`, because auth
-- users must be created through the Supabase Auth Admin API.
--
-- Inventory is intentionally NOT seeded here: stock may only be created through
-- stock movements (Phase 2+), so every quantity has an audit trail.
-- The script is idempotent (safe to run more than once).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
insert into public.categories (code, name, description) values
  ('ELEC', 'Electronics',           'Monitors, audio, webcams and personal electronics'),
  ('COMP', 'Computer Accessories',  'Peripherals, storage, cables and adapters'),
  ('NET',  'Networking',            'Switches, routers, access points and structured cabling'),
  ('OFF',  'Office Supplies',       'Paper, writing instruments, filing and consumables'),
  ('FURN', 'Office Furniture',      'Chairs, desks, storage and ergonomic accessories'),
  ('PACK', 'Packaging Materials',   'Cartons, film, tape, pallets and labels'),
  ('CLEAN','Cleaning & Hygiene',    'Cleaning agents, paper goods and disposable gloves'),
  ('TOOL', 'Tools & Hardware',      'Power tools, hand tools and warehouse equipment'),
  ('SAFE', 'Safety Equipment',      'Personal protective equipment and workplace safety')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Warehouses (5)
-- -----------------------------------------------------------------------------
insert into public.warehouses (code, name, warehouse_type, address_line, city, phone) values
  ('WH-TLV', 'Tel Aviv Central Warehouse',     'MAIN',         '12 HaBarzel St, Ramat HaHayal',        'Tel Aviv',   '03-555-0100'),
  ('WH-HFA', 'Haifa Port Logistics Center',    'DISTRIBUTION', '45 Derech HaAtsmaut',                  'Haifa',      '04-555-0200'),
  ('WH-JLM', 'Jerusalem Distribution Hub',     'REGIONAL',     '5 Kiryat HaMada St, Har Hotzvim',      'Jerusalem',  '02-555-0300'),
  ('WH-BSV', 'Be''er Sheva Regional Warehouse','REGIONAL',     '8 HaMelacha St, Emek Sara',            'Be''er Sheva','08-555-0400'),
  ('WH-ASH', 'Ashdod Logistics Park',          'DISTRIBUTION', '21 HaOrgim St, Northern Industrial Zone','Ashdod',  '08-555-0500')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Products (60) - prices in ILS
-- -----------------------------------------------------------------------------
insert into public.products
  (sku, name, category_id, unit_of_measure, cost_price, sale_price, min_stock_level, reorder_quantity, description)
select
  v.sku, v.name, c.id, v.uom, v.cost, v.price, v.min_stock, v.reorder, v.description
from (values
  -- Electronics
  ('ELE-1001', '27" IPS Monitor QHD',                 'ELEC', 'EA',    520.00,  749.00, 10,  25, '27-inch 2560x1440 IPS panel, HDMI + DisplayPort'),
  ('ELE-1002', '24" LED Monitor Full HD',             'ELEC', 'EA',    390.00,  569.00, 10,  25, '24-inch 1920x1080, VESA mount'),
  ('ELE-1003', 'Wireless Presenter Remote',           'ELEC', 'EA',     45.00,   89.00, 15,  30, 'USB receiver, laser pointer, 20 m range'),
  ('ELE-1004', 'USB-C Docking Station 11-in-1',       'ELEC', 'EA',    310.00,  459.00,  8,  20, 'Dual HDMI, Ethernet, 100 W power delivery'),
  ('ELE-1005', 'Portable Bluetooth Speaker',          'ELEC', 'EA',     95.00,  169.00, 12,  30, 'Water resistant, 12 h battery'),
  ('ELE-1006', 'Noise-Cancelling Headset',            'ELEC', 'EA',    220.00,  349.00, 10,  20, 'USB-C and Bluetooth, boom microphone'),
  ('ELE-1007', 'HD Webcam 1080p',                     'ELEC', 'EA',    120.00,  199.00, 15,  30, 'Autofocus, dual microphones, privacy shutter'),
  ('ELE-1008', 'Power Bank 20,000 mAh',               'ELEC', 'EA',     85.00,  149.00, 20,  40, 'USB-C PD 22.5 W'),
  -- Computer accessories
  ('CMP-2001', 'Wireless Mouse',                      'COMP', 'EA',     32.00,   69.00, 40, 100, '2.4 GHz, silent click'),
  ('CMP-2002', 'Mechanical Keyboard HE/EN',           'COMP', 'EA',    180.00,  289.00, 15,  30, 'Hebrew / English layout, brown switches'),
  ('CMP-2003', 'Wireless Keyboard & Mouse Combo',     'COMP', 'SET',    95.00,  159.00, 20,  50, 'Hebrew / English layout'),
  ('CMP-2004', 'USB-C to HDMI Adapter',               'COMP', 'EA',     28.00,   59.00, 30,  80, '4K @ 60 Hz'),
  ('CMP-2005', 'USB 3.0 Flash Drive 64GB',            'COMP', 'EA',     18.00,   39.00, 50, 150, 'Metal casing, keyring'),
  ('CMP-2006', 'External SSD 1TB',                    'COMP', 'EA',    290.00,  429.00, 10,  25, 'USB-C 3.2, up to 1,050 MB/s'),
  ('CMP-2007', 'Aluminium Laptop Stand',              'COMP', 'EA',     75.00,  139.00, 15,  30, 'Adjustable height, fits 10-17 inch'),
  ('CMP-2008', 'Laptop Backpack 15.6"',               'COMP', 'EA',    110.00,  199.00, 12,  30, 'Padded compartment, water resistant'),
  ('CMP-2009', 'HDMI Cable 2m',                       'COMP', 'EA',     12.00,   29.00, 60, 150, 'HDMI 2.0, braided'),
  -- Networking
  ('NET-3001', 'Gigabit Switch 8-Port',               'NET',  'EA',    115.00,  189.00,  8,  20, 'Unmanaged, metal casing'),
  ('NET-3002', 'Wi-Fi 6 Router',                      'NET',  'EA',    340.00,  499.00,  6,  15, 'AX3000 dual band'),
  ('NET-3003', 'Cat6 Patch Cable 3m',                 'NET',  'EA',      9.00,   22.00,100, 300, 'Snagless RJ45, blue'),
  ('NET-3004', 'Cat6 Cable Box 305m',                 'NET',  'ROLL',  420.00,  620.00,  4,  10, 'Solid copper, LSZH jacket'),
  ('NET-3005', 'Ceiling Wi-Fi Access Point',          'NET',  'EA',    380.00,  569.00,  5,  12, 'PoE powered, cloud managed'),
  ('NET-3006', 'Patch Panel 24-Port 1U',              'NET',  'EA',    160.00,  259.00,  4,  10, 'Cat6, 19-inch rack mount'),
  -- Office supplies
  ('OFF-4001', 'A4 Copy Paper 80gsm (5 reams)',       'OFF',  'BOX',    95.00,  139.00, 40, 100, '2,500 sheets per box'),
  ('OFF-4002', 'Ballpoint Pens Blue (50 pack)',       'OFF',  'PACK',   38.00,   65.00, 25,  60, 'Medium point 1.0 mm'),
  ('OFF-4003', 'Whiteboard Markers (4 pack)',         'OFF',  'PACK',   14.00,   29.00, 30,  80, 'Assorted colours, low odour'),
  ('OFF-4004', 'Sticky Notes 76x76mm (12 pads)',      'OFF',  'PACK',   22.00,   42.00, 30,  80, '100 sheets per pad'),
  ('OFF-4005', 'Lever Arch File A4',                  'OFF',  'EA',      9.00,   19.00, 50, 150, '75 mm spine'),
  ('OFF-4006', 'Heavy-Duty Stapler',                  'OFF',  'EA',     42.00,   79.00, 10,  25, 'Staples up to 100 sheets'),
  ('OFF-4007', 'Laminating Pouches A4 (100)',         'OFF',  'PACK',   36.00,   65.00, 10,  30, '125 micron'),
  ('OFF-4008', 'Laser Toner Cartridge Black',         'OFF',  'EA',    180.00,  279.00, 15,  40, 'Compatible, approx. 3,000 pages'),
  -- Office furniture
  ('FUR-5001', 'Ergonomic Office Chair',              'FURN', 'EA',    480.00,  799.00,  5,  12, 'Mesh back, lumbar support, 4D armrests'),
  ('FUR-5002', 'Height-Adjustable Standing Desk',     'FURN', 'EA',   1250.00, 1899.00,  3,   8, 'Dual motor, 160x80 cm top'),
  ('FUR-5003', 'Mobile Pedestal 3 Drawers',           'FURN', 'EA',    340.00,  529.00,  4,  10, 'Lockable, on castors'),
  ('FUR-5004', 'Meeting Table 180cm',                 'FURN', 'EA',   1100.00, 1650.00,  2,   5, 'Seats 6, cable tray'),
  ('FUR-5005', 'Metal Filing Cabinet 4 Drawers',      'FURN', 'EA',    620.00,  949.00,  3,   8, 'A4 / foolscap suspension files'),
  ('FUR-5006', 'Dual Monitor Arm',                    'FURN', 'EA',    160.00,  269.00,  8,  20, 'Gas spring, up to 32 inch'),
  -- Packaging
  ('PKG-6001', 'Corrugated Carton 40x30x30 (25 pcs)', 'PACK', 'PACK',   48.00,   79.00, 50, 200, 'Double wall'),
  ('PKG-6002', 'Stretch Film 50cm x 300m',            'PACK', 'ROLL',   32.00,   55.00, 40, 120, '23 micron, hand roll'),
  ('PKG-6003', 'Packing Tape Brown 48mm (36 rolls)',  'PACK', 'CASE',   85.00,  139.00, 20,  60, '66 m per roll'),
  ('PKG-6004', 'Bubble Wrap 100cm x 50m',             'PACK', 'ROLL',   65.00,  109.00, 15,  40, 'Small bubble 10 mm'),
  ('PKG-6005', 'EUR Wooden Pallet 120x80',            'PACK', 'EA',     38.00,   60.00, 30, 100, 'EPAL standard, heat treated'),
  ('PKG-6006', 'Shipping Labels A6 (500)',            'PACK', 'PACK',   45.00,   79.00, 20,  50, 'Thermal direct, perforated'),
  -- Cleaning & hygiene
  ('CLN-7001', 'Multi-Surface Cleaner 4L',            'CLEAN','EA',     24.00,   42.00, 30,  80, 'Concentrated, citrus scent'),
  ('CLN-7002', 'Liquid Hand Soap Refill 5L',          'CLEAN','EA',     35.00,   59.00, 20,  60, 'Mild, dermatologically tested'),
  ('CLN-7003', 'Paper Towel Rolls (6 pack)',          'CLEAN','PACK',   28.00,   45.00, 40, 120, '2-ply'),
  ('CLN-7004', 'Nitrile Gloves (100 pcs)',            'CLEAN','BOX',    26.00,   45.00, 50, 150, 'Powder free, size L'),
  ('CLN-7005', 'Industrial Floor Mop Set',            'CLEAN','SET',   120.00,  199.00,  5,  15, 'Bucket with wringer, 2 mop heads'),
  -- Tools & hardware
  ('TLS-8001', 'Cordless Drill 18V',                  'TOOL', 'EA',    390.00,  599.00,  5,  12, '2 batteries, charger, carry case'),
  ('TLS-8002', 'Screwdriver Set 32-piece',            'TOOL', 'SET',    65.00,  119.00, 10,  25, 'Magnetic bits, ratchet handle'),
  ('TLS-8003', 'Tape Measure 8m',                     'TOOL', 'EA',     22.00,   45.00, 20,  50, 'Auto lock, belt clip'),
  ('TLS-8004', 'Heavy-Duty Utility Knife',            'TOOL', 'EA',     14.00,   32.00, 30,  80, 'Retractable, spare blades'),
  ('TLS-8005', 'Hand Pallet Truck 2.5t',              'TOOL', 'EA',   1450.00, 2190.00,  2,   4, '1150 mm forks, polyurethane wheels'),
  ('TLS-8006', 'Steel Shelving Unit 5-Tier',          'TOOL', 'EA',    420.00,  649.00,  4,  10, '180x90x40 cm, 175 kg per shelf'),
  -- Safety equipment
  ('SAF-9001', 'Safety Helmet',                       'SAFE', 'EA',     28.00,   55.00, 20,  60, 'EN 397, adjustable ratchet'),
  ('SAF-9002', 'High-Visibility Vest',                'SAFE', 'EA',     12.00,   29.00, 40, 120, 'EN ISO 20471 class 2'),
  ('SAF-9003', 'Safety Shoes S3',                     'SAFE', 'PAIR',  140.00,  229.00, 10,  30, 'Composite toe cap, anti-slip sole'),
  ('SAF-9004', 'Workplace First Aid Kit',             'SAFE', 'EA',     95.00,  159.00,  8,  20, 'Wall mounted, up to 25 employees'),
  ('SAF-9005', 'Fire Extinguisher 6kg ABC',           'SAFE', 'EA',    160.00,  249.00,  5,  15, 'Dry powder, wall bracket'),
  ('SAF-9006', 'Protective Safety Glasses',           'SAFE', 'EA',     11.00,   25.00, 40, 100, 'Anti-fog, EN 166')
) as v(sku, name, category_code, uom, cost, price, min_stock, reorder, description)
join public.categories c on c.code = v.category_code
on conflict (sku) do nothing;

-- Deterministic EAN-13 style barcodes (Israeli 729 prefix) for all products.
update public.products p
   set barcode = b.base || (
         (10 - (
           select sum(substr(b.base, i, 1)::int * case when i % 2 = 0 then 3 else 1 end)
           from generate_series(1, 12) as i
         ) % 10) % 10
       )::text
  from (
    select id, '729' || lpad(regexp_replace(sku, '[^0-9]', '', 'g'), 9, '0') as base
    from public.products
  ) b
 where p.id = b.id
   and p.barcode is null;

-- A discontinued product, to demonstrate deactivation instead of deletion.
insert into public.products (sku, name, category_id, unit_of_measure, cost_price, sale_price, min_stock_level, reorder_quantity, description, is_active)
select 'CMP-2099', 'VGA Cable 1.5m (discontinued)', c.id, 'EA', 8.00, 19.00, 0, 0, 'Legacy item - no longer purchased', false
from public.categories c where c.code = 'COMP'
on conflict (sku) do nothing;

-- -----------------------------------------------------------------------------
-- Suppliers (10)
-- -----------------------------------------------------------------------------
insert into public.suppliers
  (code, name, contact_name, email, phone, address_line, city, country, tax_id, payment_terms_days, lead_time_days, notes)
values
  ('SUP-001', 'TechSource Distribution Ltd.',   'Yossi Levi',      'orders@techsource.example',     '03-555-1101', '14 HaMasger St',        'Petah Tikva',  'Israel', '514000101', 30,  5, 'Main supplier for computer accessories'),
  ('SUP-002', 'Galil Office Supplies Ltd.',     'Rina Cohen',      'sales@galil-office.example',    '04-555-1202', '3 HaTaasiya St',        'Karmiel',      'Israel', '514000202', 45,  4, 'Paper and stationery'),
  ('SUP-003', 'NetLink Solutions Ltd.',         'Amir Shapiro',    'b2b@netlink.example',           '09-555-1303', '8 Maskit St',           'Herzliya',     'Israel', '514000303', 30,  7, 'Networking equipment and cabling'),
  ('SUP-004', 'Negev Packaging Industries',     'Dana Peretz',     'orders@negevpack.example',      '08-555-1404', 'Industrial Zone, Bldg 12','Dimona',     'Israel', '514000404', 60, 10, 'Cartons, film and pallets'),
  ('SUP-005', 'ErgoWork Furniture Ltd.',        'Michal Avraham',  'projects@ergowork.example',     '03-555-1505', '22 HaYetsira St',       'Rishon LeZion','Israel', '514000505', 45, 21, 'Made-to-order furniture, long lead time'),
  ('SUP-006', 'CleanPro Hygiene Ltd.',          'Oren Mizrahi',    'service@cleanpro.example',      '03-555-1606', '5 HaMelacha St',        'Holon',        'Israel', '514000606', 30,  3, 'Cleaning and hygiene consumables'),
  ('SUP-007', 'Sharon Tools & Hardware',        'Eli Ben-David',   'orders@sharontools.example',    '09-555-1707', '40 Poleg Industrial Park','Netanya',    'Israel', '514000707', 30,  6, 'Tools and warehouse equipment'),
  ('SUP-008', 'SafeGuard Equipment Ltd.',       'Noa Friedman',    'sales@safeguard.example',       '04-555-1808', '11 HaHistadrut Blvd',   'Haifa',        'Israel', '514000808', 30,  5, 'PPE and fire safety'),
  ('SUP-009', 'Orion Electronics Import Ltd.',  'Gil Rosen',       'import@orion-elec.example',     '03-555-1909', '6 HaAtsmaut St',        'Rosh HaAyin',  'Israel', '514000909', 60, 14, 'Monitors and consumer electronics'),
  ('SUP-010', 'Eastern Trade Partners Co.',     'Li Wei',          'export@easterntrade.example',   '+86-755-5550-1010', 'Futian District', 'Shenzhen',     'China',  'CN-91440300X', 90, 45, 'Overseas supplier, sea freight via Haifa port')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Customers (30)
-- -----------------------------------------------------------------------------
insert into public.customers
  (code, name, customer_type, contact_name, email, phone, address_line, city, tax_id, credit_limit, payment_terms_days)
values
  ('CUS-001', 'Blue Horizon Software Ltd.',        'CORPORATE',  'Tamar Katz',       'procurement@bluehorizon.example',  '03-555-2001', '30 Rothschild Blvd',     'Tel Aviv',       '515000001', 150000, 30),
  ('CUS-002', 'Kinneret Office Solutions',         'WHOLESALE',  'Avi Golan',        'orders@kinneret-office.example',   '04-555-2002', '7 HaGalil St',           'Tiberias',       '515000002', 250000, 45),
  ('CUS-003', 'Maor Architects',                   'CORPORATE',  'Shira Maor',       'office@maor-arch.example',         '04-555-2003', '15 Moriah Blvd',         'Haifa',          '515000003',  40000, 30),
  ('CUS-004', 'Shaked Accounting Services',        'CORPORATE',  'David Shaked',     'admin@shaked-cpa.example',         '03-555-2004', '2 Jabotinsky St',        'Ramat Gan',      '515000004',  30000, 30),
  ('CUS-005', 'Arbel Logistics Ltd.',              'CORPORATE',  'Moshe Arbel',      'purchasing@arbel-log.example',     '04-555-2005', '9 HaTavor St',           'Afula',          '515000005', 120000, 60),
  ('CUS-006', 'Yarden Print House',                'RETAIL',     'Yael Yarden',      'shop@yardenprint.example',         '02-555-2006', '44 Jaffa Rd',            'Jerusalem',      '515000006',  15000, 0),
  ('CUS-007', 'Neve Tzedek Design Studio',         'RETAIL',     'Ido Barak',        'studio@nt-design.example',         '03-555-2007', '18 Shabazi St',          'Tel Aviv',       '515000007',  10000, 0),
  ('CUS-008', 'Bnei Brak Stationery Wholesale',    'WHOLESALE',  'Yaakov Klein',     'orders@bb-stationery.example',     '03-555-2008', '60 Rabbi Akiva St',      'Bnei Brak',      '515000008', 200000, 45),
  ('CUS-009', 'Eilat Hospitality Group',           'CORPORATE',  'Lior Hadad',       'supply@eilat-hosp.example',        '08-555-2009', '1 HaTmarim Blvd',        'Eilat',          '515000009', 180000, 60),
  ('CUS-010', 'Modiin Tech Park Management',       'CORPORATE',  'Keren Oz',         'facility@modiin-tp.example',       '08-555-2010', '3 HaTsoref St',          'Modiin',         '515000010',  90000, 30),
  ('CUS-011', 'Hadar Computers Ltd.',              'RETAIL',     'Sami Haddad',      'sales@hadar-pc.example',           '04-555-2011', '25 Herzl St',            'Haifa',          '515000011',  35000, 30),
  ('CUS-012', 'Lev HaIr Books & Office',           'RETAIL',     'Naama Lev',        'store@levhair.example',            '02-555-2012', '10 Ben Yehuda St',       'Jerusalem',      '515000012',  12000, 0),
  ('CUS-013', 'Negev Academic Supplies Co.',       'WHOLESALE',  'Ronen Azulay',     'orders@negev-academic.example',    '08-555-2013', '17 Rager Blvd',          'Be''er Sheva',   '515000013', 160000, 45),
  ('CUS-014', 'Pardes Hanna Farms Cooperative',    'CORPORATE',  'Ayelet Harari',    'office@ph-farms.example',          '04-555-2014', 'Moshav Road 4',          'Pardes Hanna',   '515000014',  25000, 30),
  ('CUS-015', 'Zohar Construction Ltd.',           'CORPORATE',  'Boaz Zohar',       'procurement@zohar-build.example',  '08-555-2015', '12 HaNamal St',          'Ashdod',         '515000015', 220000, 60),
  ('CUS-016', 'Hermon Engineering Ltd.',           'CORPORATE',  'Yuval Hermon',     'office@hermon-eng.example',        '04-555-2016', '6 Tel Hai Blvd',         'Kiryat Shmona',  '515000016',  60000, 30),
  ('CUS-017', 'Ofek IT Services',                  'CORPORATE',  'Hila Ofek',        'it@ofek-it.example',               '03-555-2017', '19 Ha''Arba''a St',      'Petah Tikva',    '515000017',  75000, 30),
  ('CUS-018', 'Tamar Dental Clinics',              'CORPORATE',  'Dr. Tamar Sela',   'admin@tamar-dental.example',       '08-555-2018', '4 Herzl St',             'Rehovot',        '515000018',  20000, 30),
  ('CUS-019', 'Arava Agritech Ltd.',               'CORPORATE',  'Nir Ashkenazi',    'ops@arava-agritech.example',       '08-555-2019', 'Central Arava Research Center','Arava',   '515000019',  45000, 45),
  ('CUS-020', 'Shalom Mini-Market Chain',          'WHOLESALE',  'Rami Shalom',      'buying@shalom-markets.example',    '03-555-2020', '88 Sokolov St',          'Holon',          '515000020', 140000, 45),
  ('CUS-021', 'Green Leaf Coworking',              'CORPORATE',  'Maya Green',       'hello@greenleaf-cowork.example',   '09-555-2021', '50 Weizmann St',         'Kfar Saba',      '515000021',  30000, 30),
  ('CUS-022', 'Rimon Events & Catering',           'CORPORATE',  'Omer Rimon',       'events@rimon-catering.example',    '03-555-2022', '7 HaYotser St',          'Rishon LeZion',  '515000022',  25000, 30),
  ('CUS-023', 'Dagan Food Distributors',           'WHOLESALE',  'Itzik Dagan',      'orders@dagan-food.example',        '08-555-2023', '15 HaTaasiya St',        'Kiryat Gat',     '515000023', 190000, 60),
  ('CUS-024', 'Nof Hotels Ltd.',                   'CORPORATE',  'Efrat Nof',        'purchasing@nof-hotels.example',    '09-555-2024', '2 Gad Machnes St',       'Netanya',        '515000024', 130000, 45),
  ('CUS-025', 'Alon & Partners Law Offices',       'CORPORATE',  'Adv. Gideon Alon', 'office@alon-law.example',          '03-555-2025', '1 Azrieli Center',       'Tel Aviv',       '515000025',  50000, 30),
  ('CUS-026', 'Bat Yam Electronics Store',         'RETAIL',     'Victor Levin',     'shop@by-electronics.example',      '03-555-2026', '33 Balfour St',          'Bat Yam',        '515000026',  18000, 0),
  ('CUS-027', 'Ashkelon Marine Services',          'CORPORATE',  'Shlomo Biton',     'ops@ashkelon-marine.example',      '08-555-2027', 'Marina, Pier 3',         'Ashkelon',       '515000027',  40000, 30),
  ('CUS-028', 'Central District Education Authority','GOVERNMENT','Orly Mor',        'procurement@cdea.example',         '08-555-2028', '11 Herzl St',            'Ramla',          '500100028', 300000, 90),
  ('CUS-029', 'Jerusalem Innovation Hub',          'CORPORATE',  'Ariel Weiss',      'ops@jlm-innovation.example',       '02-555-2029', '20 Hebron Rd',           'Jerusalem',      '515000029',  70000, 30),
  ('CUS-030', 'Nazareth Home & Office',            'RETAIL',     'Fadi Khoury',      'store@naz-homeoffice.example',     '04-555-2030', '5 Paulus VI St',         'Nazareth',       '515000030',  15000, 0)
on conflict (code) do nothing;
