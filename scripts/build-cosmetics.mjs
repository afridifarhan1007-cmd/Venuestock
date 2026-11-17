/**
 * Builds data/cosmetics.json from a curated, hand-authored catalogue of 200 own-brand
 * VELUNE beauty products.
 *
 * Run: node scripts/build-cosmetics.mjs
 *
 * Deterministic by design: ids, slugs, ratings, review counts, compare-at prices and stock
 * are all derived from a sha1 hash of the slug, so re-running produces a byte-identical file.
 * Every field is validated against the storefront product rules before anything is written.
 *
 * Entry shorthand: n name | s short | d description | de details ("a|b|c") |
 *                  sp specs ("k~v||k~v") | va variants ("Group~opt / opt") |
 *                  b badge | ft featured | nw new | oos out of stock
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');

const slugify = (value) =>
  String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

const hex = (slug, offset, length) => crypto.createHash('sha1').update(slug).digest('hex').slice(offset, offset + length);
const num = (slug, offset, length) => parseInt(hex(slug, offset, length), 16);

/* ------------------------------------------------------------------ *
 * SKINCARE — 60
 * ------------------------------------------------------------------ */
const SKINCARE = [
  // --- cleansers (8) ---
  {
    n: 'Silk Milk Cleanser', b: 'Fragrance-free',
    s: 'A no-foam milk cleanser that lifts the day off without stripping the skin.',
    d: 'Silk Milk is a soft, non-foaming cleanser built for mornings and for taking off a light layer of makeup. Massaged onto dry skin it slips; rinsed off, it leaves the face pliant rather than squeaky. It works well as the second cleanse after a balm.',
    de: 'Non-foaming milk texture|Lifts light makeup and sunscreen|pH 5.5, soap-free base|Squalane and glycerin keep the barrier comfortable|No fragrance, no essential oils',
    sp: 'Size~200 ml pump bottle||Skin Type~Dry, sensitive, mature||Key Actives~Squalane, glycerin, panthenol||Fragrance~None||Texture~Soft milk'
  },
  {
    n: 'Oat & Kaolin Renewing Cleanser',
    s: 'Fine white clay and colloidal oatmeal in a cream that gently resurfaces.',
    d: 'A cream cleanser holding a whisper of kaolin and colloidal oatmeal, made for skin that gets congested along the jaw and nose. It emulsifies into a thin milk as you work it, so the clay never drags across the surface. Skin reads smoother after a week of nightly use.',
    de: 'Kaolin clay absorbs surface oil|Colloidal oatmeal calms the look of redness|Low-foam cream that turns to milk|Never leaves skin tight|Use morning or night',
    sp: 'Size~150 ml soft tube||Skin Type~Combination, oily||Key Actives~Kaolin, colloidal oatmeal||Texture~Cream to milk||Fragrance~None'
  },
  {
    n: 'Charcoal Clarifying Gel Cleanser',
    s: 'A clear gel with activated charcoal and zinc for oily, congested skin.',
    d: 'A transparent gel that foams lightly and rinses clean, with activated charcoal and zinc PCA to keep shine down through the day. It is written for skin that goes grey by lunchtime and for anyone who trains in the evening. Follow with a hydrating toner while the skin is damp.',
    de: 'Light, rinse-off foam|Activated charcoal with zinc PCA|Mattifies without stripping|Sulphate-free surfactant base|Safe for daily use',
    sp: 'Size~180 ml gel bottle||Skin Type~Oily, combination||Key Actives~Charcoal, zinc PCA||pH~5.0||Fragrance~None'
  },
  {
    n: 'Melt Cleansing Balm',
    s: 'A solid balm that turns to oil and rinses away without a film.',
    d: 'Melt is a firm, scoopable balm that becomes oil against warm skin and takes waterproof mascara with it. Emulsified with water it rinses to a clear finish, with no greasy film left on the mirror. It is step one of a double cleanse, always.',
    de: 'Removes long-wear and waterproof makeup|Rice bran and sunflower seed oils|Emulsifies fully, no residue|Scoop and warm between the fingertips|Spatula included in the jar',
    sp: 'Size~100 ml jar||Skin Type~All||Key Actives~Rice bran oil, vitamin E||Finish~Soft, not oily||Fragrance~None'
  },
  {
    n: 'Salicylic 2 Clarifying Cleanser',
    s: 'A two per cent salicylic wash for breakouts along the chin and forehead.',
    d: 'A gentle cleansing gel buffered with 2 per cent salicylic acid and glycerin, so it helps clear the look of breakouts without leaving the skin flaking. Leave it on for thirty seconds before rinsing and it works considerably better. Introduce it on alternate evenings and build from there.',
    de: '2 per cent salicylic acid, a BHA|Buffered base, low irritation|Helps clear the look of breakouts|Panthenol keeps the wash comfortable|Start every other day',
    sp: 'Size~150 ml tube||Skin Type~Oily, blemish-prone||Key Actives~Salicylic acid 2 per cent, panthenol||pH~4.5||Fragrance~None'
  },
  {
    n: 'Amino Foam Cleanser',
    s: 'Amino-acid surfactants, a soft foam, and a rinse that feels like nothing.',
    d: 'A cleansing foam built on amino-acid surfactants that lifts oil and leaves no slick behind. The lather is airy rather than aggressive, and the dispensed dollop is soft enough to work near the eyes. A good first cleanser for people who dislike first cleansers.',
    de: 'Amino-acid based, soap-free|Soft, airy lather|Comfortable around the eyes|Rinses without squeaking|Equally good AM and PM',
    sp: 'Size~150 ml foam pump||Skin Type~All, including sensitive||Key Actives~Amino acid surfactants, panthenol||Fragrance~None||pH~5.5'
  },
  {
    n: 'Rose Micellar Water',
    s: 'Micelles, rose water and panthenol for a no-rinse cleanse on light days.',
    d: 'Micelles small enough to pick up oil and dust, suspended in a rose and panthenol base that leaves skin comfortable rather than sticky. Pour it over a flat pad and press rather than scrub, and the eyes stay calm. Keep it for travel and for nights when a sink is too much to ask.',
    de: 'No-rinse micellar cleanse|Rose water with panthenol|Eye-safe, no sting|Refillable 400 ml bottle|Travel size also available',
    sp: 'Size~400 ml refillable bottle||Skin Type~All||Key Actives~Micellar surfactants, panthenol, rose water||Fragrance~Light rose||Rinse~Not required'
  },
  {
    n: 'Rice Enzyme Powder Cleanser',
    s: 'A dry powder with rice enzymes that turns to milk in wet hands.',
    d: 'A weightless powder that activates with water into a soft milk, polishing dull skin with rice enzymes and finely milled rice bran. Nothing is mixed in advance, so every dose is fresh and the formula needs no heavy preservative. Use it three or four mornings a week in place of a gel.',
    de: 'Anhydrous powder, activates with water|Rice enzymes and milled rice bran|Brightens the look of dullness|Sulphate-free|Roughly two months per bottle',
    sp: 'Size~80 g shaker||Skin Type~Dull, combination||Key Actives~Rice enzymes, lactic acid||Fragrance~None||Use~3-4 mornings weekly'
  },

  // --- toners and essences (7) ---
  {
    n: 'Centella Soothing Toner',
    s: 'A weightless watery toner steeped in centella asiatica.',
    d: 'Centella asiatica leaf extract in a thin, watery toner that settles flushed skin over two passes of the hands. It layers under everything without pilling, which is the entire argument for a toner. Keep it in the fridge through summer if you like the shock of it.',
    de: 'Thin, water-light texture|Centella asiatica with panthenol|Eases the look of redness|Alcohol-free, no astringency|Layer two or three presses',
    sp: 'Size~200 ml bottle||Skin Type~Sensitive, reactive||Key Actives~Centella asiatica, panthenol||Fragrance~Fragrance-free||Alcohol~None'
  },
  {
    n: 'First Dew Essence', nw: 1, b: 'Vegan',
    s: 'Polyglutamic acid in a slim, watery essence that holds water on the skin.',
    d: 'A hydrating essence with polyglutamic acid and a little rice ferment, pressed into damp skin to hold the water your cleanser just took away. It slips in under serum and helps the next layer travel further. Light enough for the most humid month of the year.',
    de: 'Polyglutamic acid holds surface hydration|Rice ferment adds a soft glow|Apply to damp skin|Layers under serum without pilling|Vegan and fragrance-free',
    sp: 'Size~150 ml bottle||Skin Type~Dehydrated, all||Key Actives~Polyglutamic acid, rice ferment||Texture~Light essence||Fragrance~None'
  },
  {
    n: 'Niacinamide Refining Toner',
    s: 'Five per cent niacinamide in a toner for visible pores and uneven tone.',
    d: 'A watery toner with 5 per cent niacinamide and zinc, aimed at the look of enlarged pores along the cheeks and an uneven tone across the nose. It absorbs in seconds and never turns tacky under sunscreen. Use it morning and night on skin that is still damp from the cleanser.',
    de: '5 per cent niacinamide with zinc PCA|Sharpens the look of pores and tone|Fast absorbing, no tack|Alcohol free|Comfortable under makeup',
    sp: 'Size~200 ml bottle||Skin Type~Combination, oily||Key Actives~Niacinamide 5 per cent, zinc PCA||Fragrance~None||pH~5.5'
  },
  {
    n: 'Rice Ferment Glow Toner',
    s: 'Double-fermented rice water for skin that looks tired rather than clear.',
    d: 'Double-fermented rice water, lightly filtered, with a touch of glycerin; a toner for skin that reads dull after a difficult week. It carries a faint scent of the grain itself and nothing added on top. Press it in before your serum and the whole face looks brighter by lunchtime.',
    de: 'Double-fermented rice filtrate|No added fragrance, smells of grain|Brightens a tired-looking complexion|Light, watery feel|Vegan',
    sp: 'Size~180 ml bottle||Skin Type~Dull, normal||Key Actives~Rice ferment filtrate, glycerin||Fragrance~Unscented||Texture~Watery'
  },
  {
    n: 'AHA 8 Resurfacing Toner',
    s: 'Glycolic and lactic acid at 8 per cent for a weekly texture reset.',
    d: 'A buffered blend of glycolic and lactic acid that smooths rough texture and lifts dull surface cells across a week of nights. It stings briefly on freshly shaved skin, so avoid the jaw for the first two uses. A cotton pad or clean fingertips both do the job equally well.',
    de: '8 per cent AHA, glycolic and lactic|pH 3.5 for effective exfoliation|Use at night, two or three times weekly|Patch test and wear SPF next morning|Avoid the same night as retinoids',
    sp: 'Size~100 ml bottle||Skin Type~Normal, combination, dull||Key Actives~Glycolic acid, lactic acid||Strength~8 per cent AHA||Use~Nights, 2-3 weekly'
  },
  {
    n: 'Mugwort Calming Mist',
    s: 'A fine mist of mugwort and green tea for hot, reactive skin.',
    d: 'Mugwort extract and green tea in a mist fine enough to pass over makeup at three in the afternoon. It cools the look of flush and takes the tightness out of an air-conditioned room. Keep one on the desk and one in the bag, and refill both from the large bottle.',
    de: 'Ultra-fine mist, safe over makeup|Mugwort with green tea|Eases the look of redness|Refillable aluminium bottle|No alcohol',
    sp: 'Size~100 ml refillable mist||Skin Type~Sensitive, redness-prone||Key Actives~Mugwort, green tea, panthenol||Fragrance~Herbal, natural||Alcohol~None'
  },
  {
    n: 'Green Tea Essence Lotion',
    s: 'A milky lotion brewed with green tea for antioxidant morning care.',
    d: 'A light milky lotion made with cold-brewed green tea and a little squalane, designed as an antioxidant first step for city skin. It drinks in quickly and leaves a faint satin rather than shine. Good under sunscreen for the days a serum feels like too many steps.',
    de: 'Cold-brewed green tea, rich in polyphenols|Squalane for light comfort|Softens the look of fatigue|Milky and fast absorbing|Vegan',
    sp: 'Size~180 ml bottle||Skin Type~All||Key Actives~Green tea, squalane||Texture~Milky lotion||Fragrance~None'
  },

  // --- serums and treatments (12) ---
  {
    n: 'Vitamin C 15 Brightening Serum', ft: 1,
    s: 'Ethyl ascorbic acid at 15 per cent, stable in the bottle and never sticky.',
    d: 'A water-light serum using 15 per cent ethyl ascorbic acid, the derivative that stays clear in the bottle and does not turn your pillowcase orange. Paired with ferulic acid and vitamin E, it fades the look of dark marks slowly and evenly over a season. Wear it in the morning, under sunscreen.',
    de: '15 per cent ethyl ascorbic acid|Stabilised with ferulic acid and vitamin E|Fades the look of post-sun marks|Non-sticky under sunscreen|Stays clear six months after opening',
    sp: 'Size~30 ml airless pump||Skin Type~All, including oily||Key Actives~Ethyl ascorbic acid 15 per cent, ferulic acid||Time~Morning||Packaging~Light-free airless'
  },
  {
    n: 'Ascorbyl Phosphate 10 Serum',
    s: 'Sodium ascorbyl phosphate for skin that finds vitamin C irritating.',
    d: 'A gentler brightening serum built on sodium ascorbyl phosphate, which converts slowly on the skin and does not sting a compromised barrier. It suits reactive complexions, and it sits comfortably alongside niacinamide. Give it eight weeks before deciding whether it is working.',
    de: '10 per cent sodium ascorbyl phosphate|Stable water-soluble vitamin C derivative|Comfortable on sensitive skin|Layers happily with niacinamide|Fragrance-free',
    sp: 'Size~30 ml dropper||Skin Type~Sensitive, reactive||Key Actives~Sodium ascorbyl phosphate 10 per cent||Time~Morning or night||Fragrance~None'
  },
  {
    n: 'Niacinamide 10 Zinc Serum', ft: 1, b: 'Bestseller',
    s: 'Ten per cent niacinamide with zinc, reformulated so it never pills.',
    d: 'Ten per cent niacinamide with 1 per cent zinc PCA in a gel serum reworked with less film-former, so it no longer rolls off under sunscreen. It calms shine, softens the look of pores and evens tone across a season of use. The staple of the range for blemish-prone skin.',
    de: '10 per cent niacinamide, 1 per cent zinc PCA|Low-pilling gel base|Reduces the look of shine and pores|Written for blemish-prone skin|Vegan and fragrance-free',
    sp: 'Size~30 ml dropper||Skin Type~Oily, blemish-prone||Key Actives~Niacinamide 10 per cent, zinc PCA||Time~AM or PM||Fragrance~None'
  },
  {
    n: 'Three Weight Hyaluronic Serum',
    s: 'Three molecular weights of hyaluronic acid for a plumper-looking face.',
    d: 'High, mid and low molecular weight hyaluronic acid in one serum, so hydration sits on the surface and draws deeper as it dries. Apply it to damp skin and seal with a cream inside the same minute. It is the least glamorous bottle in the range and the one people quietly repurchase.',
    de: 'High, mid and low molecular weight HA|Always apply to damp skin|Plumps the look of fine lines|Gel-light, no tack after sixty seconds|Seals under any moisturiser',
    sp: 'Size~30 ml dropper||Skin Type~Dehydrated, all||Key Actives~Hyaluronic acid, three weights, panthenol||Texture~Light gel||Fragrance~None'
  },
  {
    n: 'Retinaldehyde 0.05 Night Serum',
    s: 'Retinaldehyde, one step from the prescription form, in a slow-release cream.',
    d: 'Retinaldehyde at 0.05 per cent works faster than retinol and irritates less than you would expect, because it is suspended in an oat-lipid cream that releases it gradually. Begin with two nights a week and build as tolerance allows. The bottle is opaque for a reason; keep it that way.',
    de: '0.05 per cent retinaldehyde|Encapsulated in an oat lipid cream|Smooths texture and softens the look of lines|Start twice weekly, build slowly|Not for use during pregnancy',
    sp: 'Size~30 ml opaque airless||Skin Type~Normal, mature, congested||Key Actives~Retinaldehyde 0.05 per cent||Time~Night only||Strength~0.05 per cent'
  },
  {
    n: 'Bakuchiol Comfort Serum',
    s: 'A plant-derived smoothing serum for skin that cannot hold a retinoid.',
    d: 'A gentle smoothing serum built on 1 per cent bakuchiol and squalane, for those who go red at the mention of retinol. It is a dry oil that sinks in overnight and leaves no mark on the pillow. Use it nightly; it does not sensitise skin to the sun the way stronger actives can.',
    de: '1 per cent bakuchiol, plant-derived|Squalane base with no residue|No photosensitising, use year-round|Alternative for retinoid-intolerant skin|Fragrance-free',
    sp: 'Size~30 ml dropper||Skin Type~Sensitive, retinoid-intolerant||Key Actives~Bakuchiol 1 per cent, squalane||Time~Night||Fragrance~None'
  },
  {
    n: 'Azelaic Fluid 10',
    s: 'A weightless azelaic acid fluid for marks, flush and blocked pores.',
    d: 'Azelaic acid at 10 per cent in a thin fluid that does not pill under makeup, made for the marks left behind and the persistent redness around the nose. It reads slightly powdery on application before settling, which is normal for this active at this strength. Give it six honest weeks.',
    de: '10 per cent azelaic acid|Fades the look of post-blemish marks|Eases persistent redness|Matte finish with no pilling|Sits well alongside niacinamide',
    sp: 'Size~30 ml airless||Skin Type~Blemish-prone, redness-prone||Key Actives~Azelaic acid 10 per cent||Time~AM or PM||Finish~Matte'
  },
  {
    n: 'Peptide Complex Firm Serum',
    s: 'Four signal peptides in a satin serum for the look of firmness.',
    d: 'A firming serum combining a four-peptide complex with a little panthenol, formulated at a pH that keeps everything working together rather than fighting. It gives an immediate satin finish and, after a month, a bounce you can feel with a fingertip. Press it into the jaw and down the neck.',
    de: 'Four-peptide signal complex with panthenol|Firmness and bounce across 4-6 weeks|Satin base, never sticky|Jaw and neck friendly|Fragrance-free',
    sp: 'Size~30 ml dropper||Skin Type~Mature, tired||Key Actives~Peptide complex, panthenol||Time~AM and PM||Texture~Satin serum'
  },
  {
    n: 'Centella Repair Serum',
    s: 'A honey-toned centella serum for skin recovering from over-exfoliation.',
    d: 'A concentrated centella asiatica serum with madecassoside and a slip of glycerin, written for the shiny, tight look of a barrier you have worked too hard. It stings almost never, which is how you know it is on your side. Layer it under anything, including a retinoid on the nights you keep going.',
    de: 'Centella asiatica with madecassoside|Rebuilds the look of a compromised barrier|Sting-free on sensitised skin|Gel-honey texture that absorbs fully|Vegan',
    sp: 'Size~30 ml dropper||Skin Type~Compromised, sensitised||Key Actives~Centella asiatica, madecassoside||Fragrance~None||Texture~Gel-honey'
  },
  {
    n: 'Panthenol Comfort Drops',
    s: 'Pro-vitamin B5 drops for skin that feels thin and angry in winter.',
    d: 'High-dose panthenol with ectoin and glycerin in a light drop that takes the bite out of cold air and hot showers alike. It is the serum to pair with a strong active rather than to use instead of one. Two drops pressed over the cheeks before cream is genuinely enough.',
    de: '5 per cent panthenol with ectoin|Counters winter tightness and over-washing|Use under or over actives|Watery-light with zero film|Fragrance-free',
    sp: 'Size~30 ml dropper||Skin Type~Dry, sensitised||Key Actives~Panthenol 5 per cent, ectoin||Time~AM and PM||Fragrance~None'
  },
  {
    n: 'Turmeric Brightening Serum', nw: 1,
    s: 'A soft gold serum with turmeric and rice bran for dull, uneven tone.',
    d: 'Turmeric root extract with rice bran and vitamin E in a milky serum that leaves a faint warm glow rather than a yellow stain. It suits skin that looks flat in the middle of winter and takes a while to show anything. Shake before each use, as the pigment likes to settle.',
    de: 'Turmeric and rice bran extracts|Antioxidant support for uneven tone|Warm gold tint that does not stain on damp skin|Milky and fast absorbing|Vegan',
    sp: 'Size~30 ml dropper||Skin Type~Dull, normal||Key Actives~Turmeric, vitamin E, rice bran||Texture~Milky serum||Fragrance~None'
  },
  {
    n: 'Glycolic 7 Texture Serum',
    s: 'A low-strength glycolic serum for nightly smoothing short of a peel.',
    d: 'Seven per cent glycolic acid buffered with arginine for a slow nightly resurfacing that stops short of a treatment. It makes the skin look like skin again after a year of congestion and closed texture. Start on two nights a week, and skip it on the nights you use retinaldehyde.',
    de: '7 per cent glycolic acid, arginine buffered|Built for nightly, low-irritation use|Refines the look of texture and dullness|Do not layer over retinoids|SPF required the following morning',
    sp: 'Size~30 ml airless||Skin Type~Congested, textured||Key Actives~Glycolic acid 7 per cent||Time~Night||Strength~7 per cent'
  },

  // --- moisturisers and creams (9) ---
  {
    n: 'Ceramide Barrier Cream', ft: 1, b: 'Bestseller',
    s: 'Three ceramides and cholesterol in a cream that fixes the tightness.',
    d: 'A rich but non-greasy cream with ceramides NP, AP and EOP plus cholesterol and fatty acids in ratios the skin recognises. It is what we reach for after a retinoid, after a long flight, and after anything else the skin has been through. Deeply comfortable and never heavy on the face.',
    de: 'Ceramides NP, AP and EOP with cholesterol|Ratios matched to the skin barrier|Comforts tightness within minutes|Non-comedogenic tested|Fragrance-free, safe after actives',
    sp: 'Size~50 ml airless pump||Skin Type~Dry, compromised||Key Actives~Ceramides, cholesterol, squalane||Texture~Rich cream||Fragrance~None'
  },
  {
    n: 'Weightless Day Gel',
    s: 'A water-gel moisturiser for skin that refuses cream in July.',
    d: 'A hydrating gel with hyaluronic acid, green tea and a whisper of squalane that cools on contact and then disappears. Under sunscreen it behaves, and over it nothing moves. Written for oily, humid-climate skin that still needs water more than oil.',
    de: 'Oil-free water gel|Hyaluronic acid with green tea|Matte-comfortable finish|Never pills under sunscreen|Vegan',
    sp: 'Size~50 ml tube||Skin Type~Oily, combination||Key Actives~Hyaluronic acid, green tea, squalane||Texture~Water gel||Finish~Matte satin'
  },
  {
    n: 'Shea & Marula Night Cream',
    s: 'A dense, slow-absorbing night cream that holds the whole routine in.',
    d: 'Shea butter, marula oil and a little rice bran in a cream thick enough to seal a routine and good enough to sleep on. It melts at skin temperature instead of sitting on the surface until morning. Use it on the hands in winter as well as on the face.',
    de: 'Shea butter with marula oil|Seals serums in overnight|Melts at skin temperature|Softens the look of dehydration lines|Warm natural scent, no fragrance added',
    sp: 'Size~50 ml jar with spatula||Skin Type~Dry, mature||Key Actives~Shea butter, marula oil, vitamin E||Time~Night||Fragrance~None added'
  },
  {
    n: 'Centella Water Cream', b: 'Refillable',
    s: 'A bouncy gel-cream with centella for skin that flushes easily.',
    d: 'A light gel-cream built on centella asiatica and panthenol that settles redness and hydrates without any weight at all. It reads dewy for a minute and then turns into skin. A good single moisturiser for anyone who will not be doing a serum.',
    de: 'Centella asiatica with panthenol|Bouncy gel-cream finish|Soothes flush-prone skin|Works morning and night|Refillable glass pot',
    sp: 'Size~50 ml refillable pot||Skin Type~Sensitive, combination||Key Actives~Centella asiatica, panthenol||Texture~Gel-cream||Refill~Yes'
  },
  {
    n: 'Oat Calming Balm',
    s: 'A concentrated balm for cheeks, lips and any patch that will not settle.',
    d: 'Colloidal oatmeal, squalane and shea pressed into a small, dense balm you warm between two fingers and press onto the places that hurt. It is not a face cream; it is a spot treatment for dryness. Good on windburn and on the raw edges of the nose in cold months.',
    de: 'Colloidal oatmeal with shea butter|Warm and press onto dry patches|Use on cheeks, lips and nose edges|No essential oils|Travel-friendly metal tin',
    sp: 'Size~20 ml tin||Skin Type~Very dry, reactive||Key Actives~Colloidal oatmeal, squalane, shea||Format~Balm in tin||Fragrance~None'
  },
  {
    n: 'Green Tea Balancing Lotion',
    s: 'A runny lotion for oily skin that still needs hydrating.',
    d: 'A lotion thin as water with green tea, zinc PCA and niacinamide, made to hydrate oily skin without adding to it. It layers three times in the height of summer and never pills. The bottle is large because you will use more of it than you expect.',
    de: 'Green tea, zinc PCA and niacinamide|Fluid lotion that absorbs in seconds|Keeps shine down without drying|Alcohol free|Vegan',
    sp: 'Size~200 ml bottle||Skin Type~Oily, combination||Key Actives~Green tea, zinc PCA, niacinamide||Texture~Fluid lotion||Fragrance~None'
  },
  {
    n: 'Sea Buckthorn Day Cream', oos: 1,
    s: 'Bright from sea buckthorn, mildly tart, for winter dullness.',
    d: 'Sea buckthorn oil and carrot seed extract give this cream a genuine orange tone and a dense hit of antioxidants for skin that goes grey by February. It tints very faintly on application and then evens out into nothing. Pair it with a sunscreen by the middle of the day.',
    de: 'Sea buckthorn with carrot seed oil|Rich source of carotenoids|Faint warm tint that settles clear|Softens the look of dullness|For morning use',
    sp: 'Size~50 ml airless||Skin Type~Dull, dry||Key Actives~Sea buckthorn oil, vitamin E||Time~Morning||Fragrance~None'
  },
  {
    n: 'Neroli Comfort Cream', nw: 1,
    s: 'A soft cream scented only with neroli water, for skin that likes a ritual.',
    d: 'A medium-weight cream with squalane, glycerin and a small amount of genuine neroli distillate; the only fragranced moisturiser in the range, and lightly at that. It is written for skin that finds unscented boring and can still tolerate a real floral. Use it morning or night.',
    de: 'Neroli distillate, light natural fragrance|Squalane and glycerin base|Medium weight with a satin finish|For normal to dry skin|Patch test if highly reactive',
    sp: 'Size~50 ml jar||Skin Type~Normal, dry||Key Actives~Squalane, glycerin, neroli||Fragrance~Neroli, light||Texture~Soft cream'
  },
  {
    n: 'Barrier Repair Body Lotion',
    s: 'Ceramides for the arms and legs, in a bottle worth the size.',
    d: 'A large, unscented body lotion with ceramides, glycerin and squalane for skin that goes ashy within an hour of the shower. It absorbs fast enough to dress immediately and leaves only a faint satin at the elbows. Face and body share the same barrier, after all.',
    de: 'Ceramides and glycerin for body skin|Fast absorbing, nothing on clothing|Fragrance-free for sensitive skin|Large pump bottle|Best applied to damp skin',
    sp: 'Size~400 ml pump||Skin Type~Dry body skin||Key Actives~Ceramides, squalane, glycerin||Fragrance~None||Use~After showering'
  },

  // --- sun care (5) ---
  {
    n: 'Invisible Sun Fluid SPF 50', ft: 1, b: 'SPF',
    s: 'A thin, weightless fluid that disappears on every depth of skin.',
    d: 'A filter fluid that shakes like water and finishes with no white cast at all, on deep tones as readily as light ones. It is the sunscreen people actually reapply, because it feels like nothing on the face. Two finger widths of it cover the face and neck honestly.',
    de: 'Broad spectrum SPF 50 with PA++++|No cast on deep skin tones|Fluid texture, absorbs within a minute|Reapplies cleanly over makeup|Fragrance-free',
    sp: 'Size~50 ml bottle||SPF~50||PA rating~PA++++||Skin Type~All||Finish~Invisible',
    va: null
  },
  {
    n: 'Mineral Sunscreen SPF 30',
    s: 'Zinc oxide, unfragranced, for skin that reacts to chemical filters.',
    d: 'A non-nano zinc mineral sunscreen for reactive, recently over-exfoliated or filter-sensitive skin. It warms in and fades to a soft satin; on very deep tones it can read slightly ashy, so buff it in with damp fingertips. Gentle enough to use right up to the lash line.',
    de: '12 per cent non-nano zinc oxide|Broad spectrum SPF 30 with PA+++|For filter-sensitive and reactive skin|Buff in with damp fingertips|Safe around the eyes',
    sp: 'Size~50 ml tube||SPF~30||PA rating~PA+++||Skin Type~Sensitive, reactive||Finish~Soft satin'
  },
  {
    n: 'Tinted Day Fluid SPF 40',
    s: 'A skin-tone fluid with SPF 40 that covers as much as it protects.',
    d: 'A lightweight tinted fluid with SPF 40 in five adaptable shades, for the days you want one product to be the whole face. It evens redness and old sun marks and photographs like skin rather than makeup. Blend it with a fingertip, not a brush, and it will not go patchy.',
    de: 'Broad spectrum SPF 40 with PA++++|Five adaptable tints|Evens redness and marks|Non-comedogenic|Not a substitute for midday reapplication',
    sp: 'Size~40 ml bottle||SPF~40||PA rating~PA++++||Coverage~Sheer, adaptable||Finish~Skin',
    va: 'Shade~Fair / Light / Medium / Tan / Deep'
  },
  {
    n: 'Sun Stick SPF 50', b: 'Travel size',
    s: 'A solid SPF stick for honest touch-ups over makeup.',
    d: 'A twist-up stick of SPF 50 with squalane and vitamin E that glides over foundation without moving it, which is the only realistic way to reapply at three in the afternoon. It fits in a coat pocket and will not leak inside a bag. Drag it across the cheekbones, the nose and the ears.',
    de: 'Broad spectrum SPF 50 with PA++++|Solid twist-up, no liquid for hand luggage|Reapplies over makeup cleanly|Squalane and vitamin E base|Water resistant for 40 minutes',
    sp: 'Size~15 g stick||SPF~50||PA rating~PA++++||Format~Twist-up stick||Water resistance~40 minutes'
  },
  {
    n: 'After Sun Recovery Gel',
    s: 'A cool aloe and panthenol gel for skin that spent the day outside.',
    d: 'Aloe, panthenol and centella in a gel that goes cold-ish on contact and takes the heat out of over-exposed skin. Keep it in the fridge and use it on the shoulders as readily as the face. It is not a sunscreen and does not prevent anything on its own.',
    de: 'Aloe with panthenol and centella|Cools the feel of over-exposed skin|Fragrance-free|For face and body|Best stored chilled',
    sp: 'Size~150 ml tube||Skin Type~Sun-stressed, all||Key Actives~Aloe, panthenol, centella||Texture~Cooling gel||Fragrance~None'
  },

  // --- masks and exfoliants (5) ---
  {
    n: 'Kaolin & Dead Sea Clay Masque',
    s: 'A creamy clay masque that draws out congestion and never cracks.',
    d: 'White kaolin and dead sea salt in a creamy masque that stays workable for ten minutes instead of drying into a crust. It pulls the oil out of the T-zone and leaves the cheeks alone entirely. Rinse it away with a warm cloth rather than scrubbing at it.',
    de: 'Kaolin clay with dead sea salt|Draws out congestion without cracking|Ten minutes, twice weekly|Warm-cloth removal|Faint mineral scent, no fragrance',
    sp: 'Size~100 ml tube||Skin Type~Oily, congested||Key Actives~Kaolin, dead sea salt||Use~10 minutes, 2 weekly||Clay~Kaolin'
  },
  {
    n: 'Bentonite & Charcoal Purifying Masque', oos: 1,
    s: 'The deep-clearing one, for the week after too much sunscreen.',
    d: 'A strong bentonite and charcoal masque that shrinks slightly as it dries and lifts the grey out of a congested nose. It is not for dry or sensitive skin, and it is not a weekly habit for most people. Rinse before it fully sets and follow with a hydrating toner on damp skin.',
    de: 'Bentonite clay with activated charcoal|For congested, oily skin only|Once every seven to ten days|Rinse before it fully dries|Always follow with hydration',
    sp: 'Size~100 ml jar||Skin Type~Oily, very congested||Key Actives~Bentonite, charcoal||Use~Weekly to fortnightly||Clay~Bentonite'
  },
  {
    n: 'Overnight Rice Sleeping Mask',
    s: 'A bouncy overnight mask with rice ferment that shows by morning.',
    d: 'A sleeping mask with rice ferment, squalane and a light film that holds hydration against the pillow all night. You wake with skin that looks rested rather than shiny. A pea-sized amount is genuinely enough for the whole face, and more will only transfer to the sheet.',
    de: 'Rice ferment and squalane overnight seal|Two or three nights weekly|Light, bouncy gel|No pillow transfer once set|Vegan',
    sp: 'Size~70 ml jar||Skin Type~All, including oily||Key Actives~Rice ferment, squalane||Time~Night||Texture~Bouncy gel'
  },
  {
    n: 'Jojoba Bead Polishing Scrub',
    s: 'Soft jojoba beads, no plastic, for a one-minute surface polish.',
    d: 'Round jojoba ester beads in a cream base give a real but gentle polish, with nothing angular enough to scratch. Use it before a mask or before a trip, not once a week out of habit. The nose and the forehead are the whole job on most faces.',
    de: 'Biodegradable jojoba ester beads|No plastic microbeads|One minute, once weekly at most|Softens flaking before makeup|Safe on the neck',
    sp: 'Size~75 ml tube||Skin Type~Normal, dull, flaky||Key Actives~Jojoba beads, glycerin||Use~Once weekly||Exfoliant~Jojoba ester beads'
  },
  {
    n: 'Lactic 5 Overnight Peel',
    s: 'A low-strength lactic peel you sleep in, for dry rough texture.',
    d: 'Five per cent lactic acid at a gentle pH, in a leave-on peel you apply two nights a week and do not rinse. Lactic hydrates while it exfoliates, which is why it suits dry skin that finds glycolic too sharp. The bottle is opaque because lactic does not enjoy light.',
    de: '5 per cent lactic acid, leave-on|Hydrating AHA, kind to dry skin|Two nights weekly, no rinsing|Introduce slowly and use SPF each morning|Do not combine with retinaldehyde the same night',
    sp: 'Size~30 ml airless||Skin Type~Dry, textured||Key Actives~Lactic acid 5 per cent||Time~Night, 2 weekly||Strength~5 per cent'
  },

  // --- eye care (4) ---
  {
    n: 'Peptide Eye Cream',
    s: 'A fine peptide cream for the crepey look under the eyes.',
    d: 'A light eye cream with peptides, squalane and caffeine that smooths the crepe under the eyes enough to make concealer behave properly. It is unscented and safe right on the lash line. One grain-of-rice amount per eye, tapped in with the ring finger.',
    de: 'Peptides with squalane and caffeine|Smooths under-eye crepiness|Unscented, comfortable texture|Morning and night|A very little is enough',
    sp: 'Size~15 ml airless||Skin Type~All||Key Actives~Peptides, caffeine, squalane||Area~Under-eye and lid||Fragrance~None'
  },
  {
    n: 'Caffeine De-Puff Fluid', nw: 1,
    s: 'A cool fluid with caffeine and rice peptide for morning puffiness.',
    d: 'A watery fluid with 5 per cent caffeine, a rice peptide and a little centella that moves the morning puffiness out from under the eyes. Store it cool and apply with a fingertip, tapping outward toward the temple. It does very little for pigment, which is worth saying out loud.',
    de: '5 per cent caffeine with rice peptide|Reduces the look of morning puffiness|Tapping application, fast absorbing|Cool storage improves the feel|Layers under eye cream',
    sp: 'Size~20 ml roller bottle||Skin Type~All||Key Actives~Caffeine 5 per cent, rice peptide, centella||Time~Morning||Format~Cooling fluid'
  },
  {
    n: 'Retinal Eye Cream 0.03',
    s: 'The low-strength retinaldehyde your lash line can tolerate.',
    d: 'Retinaldehyde at 0.03 per cent in a rich, small-gauge eye cream for the fine lines at the outer corner. It is deliberately weaker than the face serum for precisely this reason. Build up to every other night, and stop for a week if the lid goes flaky.',
    de: '0.03 per cent retinaldehyde|For fine lines at the outer corner|Rich cream base, low stinging|Introduce every other night|Not for use during pregnancy',
    sp: 'Size~15 ml airless||Skin Type~Mature, tired||Key Actives~Retinaldehyde 0.03 per cent||Time~Night||Strength~0.03 per cent'
  },
  {
    n: 'Hydrogel Eye Patches',
    s: 'Six pairs of hydrogel patches soaked in centella for one long evening.',
    d: 'Thin hydrogel patches soaked in centella, panthenol and rice ferment that stay put for twenty minutes and leave the under-eye looking less hollow. Reach for them before an event or after a long flight. The foil seal matters more than the essence inside it, so check it.',
    de: 'Hydrogel soaks in rather than drying out|Centella, panthenol and rice ferment|Twelve patches in six foil pairs|Twenty minutes, then press in the rest|Single use only',
    sp: 'Size~12 patches||Skin Type~All||Key Actives~Centella, panthenol, rice ferment||Format~Hydrogel patch||Use~20 minutes'
  },

  // --- facial oils (3) ---
  {
    n: 'Squalane & Rosehip Facial Oil',
    s: 'Two oils and nothing else, for skin that needs sealing at night.',
    d: 'Refined rosehip and olive-derived squalane in a dry oil that sinks within a minute and leaves no shine on the pillow. Two oils are considerably easier to get right than twelve. Press it in as the final step over skin that is still damp from the serum.',
    de: 'Squalane with cold-pressed rosehip oil|Dry oil that absorbs in a minute|Rich in vitamin E and linoleic acid|Press over damp skin|Fragrance-free',
    sp: 'Size~30 ml dropper||Skin Type~Dry, normal||Key Actives~Squalane, rosehip oil, vitamin E||Time~Night||Fragrance~None'
  },
  {
    n: 'Marula & Camellia Night Oil',
    s: 'A richer pressing of marula and camellia for cold months.',
    d: 'Marula and camellia oils with a trace of sea buckthorn; a warmer, more emollient pressing for winter and for mature skin that has gone thirsty. It leaves a visible soft glow at ten at night and none by breakfast. Three drops into warm hands, then press.',
    de: 'Marula, camellia and a trace of sea buckthorn|More emollient than the Squalane blend|Warm glow that absorbs overnight|Three drops is a full face|Vegan',
    sp: 'Size~30 ml dropper||Skin Type~Dry, mature||Key Actives~Marula oil, camellia oil||Time~Night||Fragrance~None'
  },
  {
    n: 'Jojoba Balance Oil',
    s: 'Cold-pressed jojoba, the oil closest to what your own skin makes.',
    d: 'Jojoba is a liquid wax that skin reads as its own, which is why this single-oil serum tends to calm oily skin instead of adding to it. It is light enough to wear in the morning under sunscreen. Massage one drop into the jawline and down the neck before it is fully dry.',
    de: '100 per cent cold-pressed jojoba|Balances oily and combination skin|Light enough for daytime|Non-comedogenic|One ingredient, nothing added',
    sp: 'Size~30 ml dropper||Skin Type~Oily, combination||Key Actives~Jojoba oil 100 per cent||Time~AM or PM||Fragrance~None'
  },

  // --- lip care and sets (3) ---
  {
    n: 'Shea Lip Mask', b: 'Vegan',
    s: 'A thick, plain lip mask for overnight repair of cracked lips.',
    d: 'Shea butter, castor seed oil and a beeswax-free base pressed into a small pot you spoon onto the lips before bed. It tastes of nothing at all, which is deliberate. It is equally good on cuticles and on the edges of the nose during cold months.',
    de: 'Shea butter with castor seed oil|Overnight lip repair|Vegan base, no beeswax|Plain, with no flavour or fragrance|Small pot with a fitted lid',
    sp: 'Size~15 ml pot||Key Actives~Shea butter, castor oil, squalane||Use~Overnight||Fragrance~None||Finish~Occlusive balm'
  },
  {
    n: 'Peptide Lip Butter', nw: 1, b: 'Refillable',
    s: 'A soft, non-plumping peptide butter that makes lips look full by being healthy.',
    d: 'A creamy lip treatment with a smoothing peptide complex and murumuru butter that softens the vertical lines over time simply by keeping the surface fully hydrated. It wears under and over lipstick without sliding. Nothing tingles, because tingling has never been a result.',
    de: 'Lip-smoothing peptide complex|Murumuru and shea butters|No plumping and no tingling|Wears cleanly under lipstick|Refillable twist tube',
    sp: 'Size~10 ml tube||Key Actives~Peptides, murumuru butter, squalane||Finish~Soft sheen||Refill~Yes'
  },
  {
    n: 'Double Cleanse Duo', b: 'Travel size',
    s: 'The balm and the foam together, in the two sizes you actually travel with.',
    d: 'Melt Cleansing Balm in a 30 ml tin and the Amino Foam in a 60 ml tube, sized for a cabin bag and for a gym kit. Together they take long-wear makeup off properly in about ninety seconds. It is also the cheapest way to try the range before committing to full bottles.',
    de: '30 ml balm tin with 60 ml foam tube|Cabin-bag friendly|A full double cleanse in ninety seconds|Recyclable aluminium tin|Doubles as a gift set',
    sp: 'Size~30 ml plus 60 ml||Contents~Melt Balm, Amino Foam||Category~Cleansing set||Fragrance~None||Tin~Recyclable aluminium'
  },

  // --- body and décolleté (4) ---
  {
    n: 'Lactic Body Smoothing Lotion',
    s: 'A runny lactic acid lotion for rough bumps on the arms and thighs.',
    d: 'A light body lotion with 10 per cent lactic acid and urea, formulated for the small rough bumps on the back of the upper arms and for thighs that go gritty after shaving. It absorbs in under a minute and does not leave a film on bedding. Wear sunscreen on exposed areas, as with any acid.',
    de: '10 per cent lactic acid with urea|For keratosis-style roughness on arms and legs|Fast absorbing, no residue on clothing|Use nightly, then every other day|SPF on exposed skin while using it',
    sp: 'Size~250 ml pump||Skin Type~Rough, bumpy body skin||Key Actives~Lactic acid 10 per cent, urea||Use~Nightly||Fragrance~None'
  },
  {
    n: 'Neck and Chest Peptide Cream',
    s: 'A thicker cream for the two places everyone forgets until later.',
    d: 'A firming cream with a peptide complex, squalane and a little niacinamide, deliberately heavier than a face cream so it stays on the neck long enough to matter. It is made for horizontal lines at the throat and the sun-damaged plane of the chest. Massage upward, and follow with SPF in the morning.',
    de: 'Peptide complex with niacinamide|Heavier base so it stays on the neck|Smooths the look of horizontal throat lines|For neck, jaw and chest|Always follow with sun protection',
    sp: 'Size~70 ml tube||Skin Type~Mature, sun-exposed||Key Actives~Peptide complex, niacinamide, squalane||Area~Neck, jaw and chest||Time~Night'
  },
  {
    n: 'Back and Chest Clarifying Wash',
    s: 'A salicylic body wash for the breakouts that sit under a shirt.',
    d: 'A foaming body wash with 2 per cent salicylic acid and zinc, made for the back, chest and shoulders where sweat and sunscreen block the pores. Leave the lather on for a minute before rinsing, and use a long-handled brush if the reach is the problem. It will not help hormonal breakouts below the jaw, which are a different matter.',
    de: '2 per cent salicylic acid body wash|Zinc PCA for the look of shine|Hold the lather for sixty seconds|Long-handled brush helps the reach|Use on back, chest and shoulders only',
    sp: 'Size~300 ml pump||Skin Type~Blemish-prone body skin||Key Actives~Salicylic acid 2 per cent, zinc PCA||Use~Daily in the shower||Fragrance~None'
  },
  {
    n: 'Sun Powder SPF 50', nw: 1,
    s: 'A tinted powder that tops up your sunscreen over makeup at noon.',
    d: 'A pressed mineral powder with SPF 50 and zinc oxide, the only realistic way to reprotect a fully made-up face at midday without ruining it. It blots shine at the same time, which suits combination and oily skin. Press it on with the puff rather than sweeping it, and take it to the hairline.',
    de: 'Broad spectrum SPF 50 with PA++++|Mineral zinc oxide powder|Reapplication over makeup|Blots shine while protecting|Press, do not sweep',
    sp: 'Size~9 g compact||SPF~50||PA rating~PA++++||Format~Pressed powder||Finish~Mattified',
    va: 'Shade~Translucent / Light / Medium / Deep'
  }
];

/* ------------------------------------------------------------------ *
 * MAKEUP — 50
 * ------------------------------------------------------------------ */
const MAKEUP = [
  // --- base and face (14) ---
  {
    n: 'Second Skin Liquid Foundation', ft: 1, b: 'Bestseller',
    s: 'A medium-coverage liquid that dries down to skin and stays there.',
    d: 'Second Skin is a fluid foundation with buildable medium coverage that loses its finish entirely within two minutes and reads as skin by lunchtime. It moves with the face rather than cracking at the smile lines, and it photographs without a grey cast. Sixteen shades span cool, neutral and warm.',
    de: 'Buildable medium coverage|Dries down to a natural skin finish|Transfer-resistant after two minutes|Sixteen shades, cool neutral and warm|Shake before use, one pump is a full face',
    sp: 'Finish~Natural skin||Coverage~Medium, buildable||Shade range~16 shades||Size~30 ml pump bottle||Wear~10-12 hours',
    va: 'Shade~Porcelain 100 / Ivory 120 / Shell 140 / Linen 160 / Sand 200 / Honey 240 / Amber 300 / Chestnut 360'
  },
  {
    n: 'Serum Foundation Medium Coverage', nw: 1,
    s: 'Half skincare, half foundation, with hyaluronic acid and squalane inside.',
    d: 'A fluid foundation carrying hyaluronic acid, squalane and niacinamide so it behaves on skin that is drier than it was in September. The coverage is medium and melts in with a fingertip, never with a brush pressed hard. It wears best on skin prepped with nothing but a light moisturiser.',
    de: 'Medium coverage with a dewy-satin finish|Hyaluronic acid, squalane and niacinamide inside|Melts in with fingertips|Comfortable on dry and mature skin|Twelve adaptable shades',
    sp: 'Finish~Dewy satin||Coverage~Medium||Shade range~12 shades||Size~30 ml pump bottle||Key Actives~Hyaluronic acid, squalane, niacinamide',
    va: 'Shade~Ivory 110 / Shell 130 / Sand 170 / Honey 210 / Amber 280 / Mahogany 380'
  },
  {
    n: 'Matte Velvet Foundation',
    s: 'A soft matte that powders on the skin instead of drying on it.',
    d: 'A matte foundation built with silica microspheres rather than alcohol, so it sets to velvet without the tight, papery feeling most longwear mattes leave behind. It holds through heat and through a full day under a mask. Use a thin layer and build only where you need it.',
    de: 'Soft matte velvet finish|Silica microspheres, no alcohol drying|Longwear through heat and humidity|Oil-free and non-comedogenic|Build thin, do not cake',
    sp: 'Finish~Soft matte||Coverage~Medium to full||Shade range~14 shades||Size~30 ml pump bottle||Wear~12 hours',
    va: 'Shade~Porcelain 100 / Ivory 120 / Sand 190 / Honey 230 / Amber 300 / Walnut 400'
  },
  {
    n: 'Bare Skin Tint',
    s: 'A sheer tint for the days when the only job is looking rested.',
    d: 'A watery tint with barely any pigment and a good deal of glycerin, made to even the colour of a face without anyone noticing a product on it. It will not hide anything and is not trying to. Ten shades, all of them translucent enough to be forgiving.',
    de: 'Sheer, wash-of-colour coverage|Glycerin and panthenol base|Ten forgiving translucent shades|Safe around the eyes|Perfect for hands-free mornings',
    sp: 'Finish~Fresh skin||Coverage~Sheer||Shade range~10 shades||Size~40 ml tube||Key Actives~Glycerin, panthenol',
    va: 'Shade~Fair 01 / Light 03 / Medium 05 / Tan 07 / Deep 09'
  },
  {
    n: 'Cream Concealer Pot',
    s: 'A pot of full-coverage cream that does not crease when it is warm.',
    d: 'A dense, high-pigment cream concealer that needs warming on the lid of the pot before it will spread, which is exactly why it stays put. It covers marks, veins and tattoo edges with a small amount pressed rather than swiped. Twelve shades, from fair to deep.',
    de: 'Full coverage cream formula|Warm it on the lid before use|Press, do not swipe|Crease-resistant once set|Twelve shades with a fine milled pigment',
    sp: 'Finish~Soft matte||Coverage~Full||Shade range~12 shades||Size~6 g pot||Application~Brush or fingertip',
    va: 'Shade~Fair 02 / Light 04 / Medium 06 / Tan 08 / Deep 10 / Rich 12'
  },
  {
    n: 'Brightening Under-Eye Concealer',
    s: 'A light-reflecting concealer for hollows, with caffeine in the base.',
    d: 'A fine, hydrating concealer with light-reflecting mica and a little caffeine, formulated thin enough not to settle into under-eye creases by four in the afternoon. It lifts shadow and hollowness rather than painting over it. One tiny dot, tapped out with a ring finger.',
    de: 'Light-diffusing mica with caffeine|Hydrating base for the delicate eye area|Thin layer, tapped not dragged|Six shades tuned to neutralise blue and brown|Non-migrating once set',
    sp: 'Finish~Luminous natural||Coverage~Medium||Shade range~6 shades||Size~7 ml applicator wand||Key Actives~Caffeine, hyaluronic acid',
    va: 'Shade~Fair Peach 01 / Light Neutral 02 / Medium Beige 03 / Tan Warm 04 / Deep Golden 05 / Rich Neutral 06'
  },
  {
    n: 'Blur Primer',
    s: 'A silicone-soft primer that fills pores and gives foundation something to hold.',
    d: 'A smoothing, pore-filling primer with dimethicone and bamboo powder that turns textured skin into a level surface before any colour touches it. It works best pressed into the nose and cheeks alone, not the whole face. Foundation applied over it slides less and lasts longer.',
    de: 'Pore-filling, smoothing base|Dimethicone with bamboo powder|Press into the T-zone only|Oil-free and silicone based|Extends foundation wear',
    sp: 'Finish~Blurred matte||Size~30 ml tube||Skin Type~Oily, textured, large pores||Free from~Fragrance||Layer~Under foundation'
  },
  {
    n: 'Glow Primer',
    s: 'A luminous primer for skin that wants to look lit from the front.',
    d: 'A hydrating primer with fine light-catching pigments and squalane, for skin that goes flat under foundation in winter. It gives a soft sheen across the high points and stops powder from reading chalky. Use it alone with a concealer on the no-makeup days.',
    de: 'Luminous, light-catching finish|Squalane and glycerin base|Use under or entirely alone|Keeps powder from looking flat|Six universal tones',
    sp: 'Finish~Luminous||Size~30 ml tube||Skin Type~Normal, dry, mature||Free from~Fragrance||Layer~Under foundation'
  },
  {
    n: 'Pore Smoothing Primer',
    s: 'A mattifying primer with niacinamide for skin that slips by noon.',
    d: 'A weightless mattifying primer with niacinamide and zinc that keeps the shine down in the middle of the face and gives foundation a surface to sit on. It dries to a soft blur in about thirty seconds, so work in sections on hot days. A pea-size is the whole face.',
    de: 'Mattifying with niacinamide and zinc PCA|Dries to a soft blur in thirty seconds|Work in sections|Extends wear on oily skin|Vegan and fragrance-free',
    sp: 'Finish~Mattified blur||Size~30 ml tube||Skin Type~Oily, combination||Key Actives~Niacinamide, zinc PCA||Layer~Under foundation'
  },
  {
    n: 'Longwear Setting Spray',
    s: 'A fine mist that locks base makeup without the squeaky film.',
    d: 'A fast-drying setting spray with a flexible film-former that keeps foundation and concealer exactly where you put them through a long day and a warm room. It mist finely, dries in seconds and never leaves the face feeling lacquered. Hold it at arm length and cross the face twice.',
    de: 'Flexible, non-lacquering hold|Ultra-fine mist, dries in seconds|Keeps base in place 12 hours|Alcohol-light base with glycerin|Vegan and cruelty free',
    sp: 'Finish~Natural matte||Size~100 ml spray||Hold~Longwear||Layer~Final step||Free from~Fragrance'
  },
  {
    n: 'Dewy Finish Setting Spray',
    s: 'A setting spray that puts the glow back after powder.',
    d: 'A hydrating mist that melts powder and foundation back into one surface and returns a dewy finish to a face that went flat at the compact stage. Panthenol and rice water sit in the base, so it is also a decent midday refresh. Two passes, held at arm length.',
    de: 'Dewy, skin-like finish after powder|Panthenol and rice water base|Melts powder into skin|Doubles as a midday refresh|Vegan and cruelty free',
    sp: 'Finish~Dewy||Size~100 ml spray||Hold~Medium||Layer~Final step||Key Actives~Panthenol, rice water'
  },
  {
    n: 'Loose Finishing Powder',
    s: 'A finely milled translucent powder that disappears instead of drying.',
    d: 'A silky, finely milled loose powder with silica and a small amount of squalane, which means it sets the face without pulling moisture out of it. It photographs without flashback and works on every depth of skin. Press it in with a sponge, then brush the excess away.',
    de: 'Finely milled silica base|Squalane keeps it from drying|No flashback in photographs|Four tints from translucent to deep|Press with a sponge, brush off excess',
    sp: 'Finish~Soft matte, translucent||Size~12 g pot||Skin Type~All||Shade range~4 tints||Free from~Talc, fragrance',
    va: 'Shade~Translucent / Light / Medium / Deep'
  },
  {
    n: 'Pressed Setting Powder',
    s: 'The loose powder, pressed into a mirror case worth opening in public.',
    d: 'A pressed version of the same finely milled silica base, dense enough to travel and matte enough to blot a nose at a dinner table. The compact carries a real mirror and a velvet puff rather than a plastic scoop. Press, do not sweep, and it will not disturb the base under it.',
    de: 'Pressed silica base, no talc|Travel compact with a genuine mirror|Velvet press puff included|Blots shine without caking|Refillable case',
    sp: 'Finish~Soft matte||Size~9 g refillable compact||Skin Type~All||Shade range~3 tints||Refill~Yes',
    va: 'Shade~Translucent / Light / Medium'
  },
  {
    n: 'Blurring Multipurpose Balm',
    s: 'One stick that evens the face, hides a shadow and softens a lip line.',
    d: 'A soft, blendable stick balm that evens tone across the whole face, works as an under-eye corrector when applied thin and conditions the lip line when applied thick. It is the product to keep in a bag, a desk drawer and a coat pocket. Six shades, all buildable to nothing.',
    de: 'Face, eye and lip in one stick|Buildable from sheer to medium|Shea and squalane base|Twist-up, no sharpener needed|Six blendable shades',
    sp: 'Finish~Satin||Coverage~Sheer to medium||Size~6 g twist stick||Use~Face, eyes, lips||Key Actives~Shea butter, squalane',
    va: 'Shade~Fair 01 / Light 03 / Medium 05 / Tan 07 / Deep 09 / Rich 11'
  },

  // --- cheeks (8) ---
  {
    n: 'Cream Blush Pot', ft: 1,
    s: 'A pot of sheer cream pigment that reads like skin you have just walked in from the cold.',
    d: 'A whipped cream blush with a low pigment load, so you can build from nothing to a real flush in three taps without ever looking painted. It melts into bare skin and holds its colour through the evening. Dab it onto the apples with fingertips warm from rubbing them.',
    de: 'Sheer, buildable cream pigment|Melts into skin, never patchy|Long-wearing through the evening|Tap on with fingertips|Five shades, all skin-compatible',
    sp: 'Finish~Skin-like dew||Size~6 g pot||Coverage~Sheer, buildable||Shade range~5 shades||Free from~Fragrance',
    va: 'Shade~Petal / Terracotta / Plum Ash / Warm Rose / Brick'
  },
  {
    n: 'Liquid Blush Droplet',
    s: 'Three drops of pigment for a flush that comes from underneath.',
    d: 'A watery liquid blush that disperses evenly across the cheeks in seconds and dries to a finish indistinguishable from skin. Two or three drops on the back of the hand, then press on with a sponge or fingers. It layers over foundation without lifting it.',
    de: 'Watery, second-skin liquid blush|Press on with sponge or fingers|Layers over foundation cleanly|High pigment, use sparingly|Vegan and cruelty free',
    sp: 'Finish~Natural glow||Size~15 ml dropper||Coverage~Sheer to medium||Shade range~6 shades||Application~Dropper',
    va: 'Shade~Dew Rose / Soft Peach / Warm Clay / Berry Water / Terracotta'
  },
  {
    n: 'Powder Blush',
    s: 'A satin powder blush that goes on visible and dries down soft.',
    d: 'A finely milled powder blush with a satin finish, so it is easy to place accurately and hard to overdo. The pigment is honest on application and settles a shade softer within a minute. Sweep a fluffy brush along the cheekbone and blend upward toward the temple.',
    de: 'Finely milled, satin powder|High pigment that settles soft|Blend upward toward the temple|Ten shades across cool and warm|Refillable pan',
    sp: 'Finish~Satin||Size~6 g pan||Coverage~Medium, buildable||Shade range~10 shades||Refill~Yes',
    va: 'Shade~Muted Rose / Warm Apricot / Clay Rose / Soft Plum / Terracotta / Cool Berry'
  },
  {
    n: 'Cheek and Lip Balm',
    s: 'A tinted balm for both, in a tube that fits a jacket pocket.',
    d: 'A cushioned tinted balm that gives the cheeks a wash of colour and the lips a matching softness, with shea and jojoba underneath so neither goes dry. It wears off evenly instead of leaving a ring. Reapply from a mirror if you like; nobody will notice if you do not.',
    de: 'Two-use tint for cheeks and lips|Shea and jojoba base|Wears off evenly, no ring|Pocket tube with a sponge applicator|Six shades',
    sp: 'Finish~Soft balm sheen||Size~8 ml tube||Use~Cheeks and lips||Shade range~6 shades||Key Actives~Shea butter, jojoba',
    va: 'Shade~Nude Rose / Warm Peach / Brick / Berry / Brown Sugar'
  },
  {
    n: 'Terracotta Bronzer', oos: 1,
    s: 'A matte warm powder that reads as an afternoon, not as orange.',
    d: 'A baked terracotta bronzer with no shimmer and no orange in the pigment, made to warm the face where the sun would naturally hit it. It is buildable in sheer layers, which is the only way bronzer ever looks convincing. Sweep it along the hairline, the nose and the cheekbone.',
    de: 'Baked powder, matte warm finish|No shimmer, no orange undertone|Buildable in sheer layers|Four depths of bronze|Works with a flat or a fluffy brush',
    sp: 'Finish~Matte warm||Size~10 g baked pan||Shade range~4 bronzes||Skin Type~All||Free from~Fragrance',
    va: 'Shade~Light Bronze / Warm Bronze / Deep Bronze / Rich Bronze'
  },
  {
    n: 'Powder Highlighter',
    s: 'A champagne highlighter fine enough to wear before noon.',
    d: 'A pressed highlighter with extremely fine, skin-melting pearl rather than visible glitter, so it catches the light at an angle and disappears head-on. It sits beautifully on bare skin and over powder alike. One pass on the cheekbone is the whole trick.',
    de: 'Ultra-fine pearl, no visible glitter|Press on the high points only|Beautiful over powder or bare skin|Four tones from pearl to bronze|Refillable pan',
    sp: 'Finish~Luminous fine pearl||Size~6 g pan||Shade range~4 tones||Skin Type~All||Refill~Yes',
    va: 'Shade~Pearl / Champagne / Rose Gold / Warm Bronze'
  },
  {
    n: 'Highlighter Stick',
    s: 'A cream highlight you can apply without a brush or a mirror.',
    d: 'A cushioned stick highlighter with a soft, wet-look sheen that you swipe and tap in with a fingertip in about ten seconds. It moves over the contours of the cheekbone instead of drawing a line across them. Squalane keeps it from clinging to texture.',
    de: 'Cream stick, no tools needed|Wet-look sheen that taps out softly|Squalane base, will not cling to texture|Three adaptable tones|Twist up only a centimetre',
    sp: 'Finish~Wet glow||Size~6 g twist stick||Shade range~3 tones||Skin Type~Normal, dry||Application~Fingertip',
    va: 'Shade~Frost Pearl / Champagne / Golden Hour'
  },
  {
    n: 'Blush Duo Compact',
    s: 'Two shades in one case for the cheekbone and the apple.',
    d: 'A baked duo with one deeper contour shade and one soft flush, designed to be swept together for a cheek that looks three-dimensional rather than flat. The pan is thin enough to layer and the case is slim enough for a small bag. Blend them together or keep them separate.',
    de: 'Baked two-pan cheek duo|Sweep together or layer separately|Thin, blendable bake|Slim travel case with a mirror|Vegan and cruelty free',
    sp: 'Finish~Satin bake||Size~8 g duo pan||Shade range~4 duos||Skin Type~All||Case~Slim with mirror',
    va: 'Duo~Rose and Clay / Peach and Terracotta / Plum and Berry / Nude and Brick'
  },

  // --- eyes (15) ---
  {
    n: 'Eyeshadow Mono',
    s: 'A single baked shade that works as shadow, liner and a soft wash.',
    d: 'A baked mono with a buttery, low-fallout payoff that can be applied with a fingertip as a wash, or with a damp brush as a definable liner. The pigments are milled fine enough to sit flat on the lid all day. Nine shades, matte and satin, all of them buildable.',
    de: 'Baked formula, low fallout|Use dry as a wash, damp as a liner|Fingertip application works well|Nine interchangeable shades|Vegan and cruelty free',
    sp: 'Finish~Matte and satin||Size~3 g pan||Shade range~9 shades||Application~Dry or damp||Free from~Fragrance',
    va: 'Shade~Warm Taupe / Soft Brown / Olive Ash / Burnt Sienna / Plum Slate / Ink Navy / Charcoal / Bone / Pearl Sand'
  },
  {
    n: 'Eyeshadow Quad',
    s: 'Four coordinated shades that make the decision for you.',
    d: 'A quad built around one depth, one flush and two neutrals, chosen so that any combination of them works on a tired face in ninety seconds. The mattes blend cleanly and the satin sits in the middle of the lid without migrating. A genuine travel palette.',
    de: 'Four coordinated matte and satin shades|Blend without patchiness|No shimmer in the crease shades|Slim magnetic case|Refillable individual pans',
    sp: 'Finish~Matte and satin||Size~4 x 2 g||Shade range~5 quads||Application~Brush or fingertip||Case~Refillable magnetic',
    va: 'Quad~Soft Neutral / Warm Clay / Cool Smokey / Olive Sunset / Rose Taupe'
  },
  {
    n: 'Studio Eyeshadow Palette',
    s: 'Twelve pans of the working shades, from bone to charcoal.',
    d: 'A twelve-pan palette built for the way most people actually use shadow: nine mattes in wearable depths and three finishes for the middle of the lid. Every matte is milled for low fallout and blends with a clean brush alone. It is the one palette to keep on a desk.',
    de: 'Nine mattes and three finishes|Low-fallout micronised pigment|Blend with a clean brush, no primer needed|Full-size mirror in the lid|Magnetic pans for custom builds',
    sp: 'Finish~Matte, satin, shimmer||Size~12 x 1.5 g||Shade range~12 shades||Mirror~Full size||Case~Magnetic, customisable'
  },
  {
    n: 'Liquid Eyeliner Pen',
    s: 'A felt tip with a genuinely fine point and an honest black.',
    d: 'A liquid liner with a firm felt tip that starts every time, in a black dense enough to read at the back of a room and a flexible film that survives a full day without flaking off at the outer corner. Draw from the middle of the lid outward, not from the inner corner. It dries in twenty seconds.',
    de: 'Firm felt tip, no flopping|Deep true black pigment|Smudge-resistant film, no flaking|Dries in about twenty seconds|Recyclable barrel',
    sp: 'Finish~Matte black||Size~0.6 ml pen||Wear~12 hours||Tip~Felt, fine||Free from~Fragrance',
    va: 'Shade~Black / Soft Brown / Slate / Deep Plum'
  },
  {
    n: 'Gel Eyeliner Pot', nw: 1,
    s: 'A pot liner that stays workable for a minute, then sets for twelve hours.',
    d: 'A cream gel liner in a small sealed pot that gives you a moment to place a line precisely before it sets to a water-resistant finish. It smudges deliberately as a smoked liner if you want that, and refuses to move if you do not. Pair it with an angled brush and keep the lid closed.',
    de: 'Workable for sixty seconds, then sets|Water-resistant once dry|Doubles as a smoked smudge|Pot stays soft with the lid sealed|Use with an angled brush',
    sp: 'Finish~Soft matte||Size~4 g pot||Wear~12 hours||Tip~Angled brush||Water resistance~Resistant once set',
    va: 'Shade~Black / Espresso / Olive Ink / Navy / Plum'
  },
  {
    n: 'Kohl Eyeliner Pencil',
    s: 'A soft kohl for the waterline that never pulls the lid.',
    d: 'A cushioned kohl pencil with enough slip to line the waterline without dragging, and enough pigment to make the eye look denser rather than drawn. It sets softly within a minute, so the smudge is intentional rather than accidental. Twist up, no sharpener to lose.',
    de: 'Cushioned glide, no dragging on the lid|Safe for the waterline|Sets softly within a minute|Twist-up, no sharpening|Vegan formula',
    sp: 'Finish~Soft smudge||Size~1.2 g twist pencil||Wear~8 hours||Use~Waterline and lash line||Free from~Fragrance',
    va: 'Shade~Black / Brown / Charcoal / Deep Burgundy / Sand'
  },
  {
    n: 'Lengthening Mascara',
    s: 'A thin brush and a light formula for lashes that look longer, not heavier.',
    d: 'A lengthening mascara with a narrow tapered brush and a flexible film that combs each lash individually and stretches it a shade. It does not add much volume, and that is the honest trade for zero clumping and no evening fallout. Two coats, rolled from the root rather than pumped.',
    de: 'Narrow tapered brush, no clumping|Flexible film with light hold|Rolled from the root, never pumped|Removes with warm water and a cotton pad|Two coats is plenty',
    sp: 'Finish~Natural length||Size~9 ml tube||Wear~Daylight hours||Brush~Tapered comb||Removal~Warm water',
    va: 'Shade~Black / Brown / Warm Brown'
  },
  {
    n: 'Volume Mascara', ft: 1, b: 'Bestseller',
    s: 'A dense brush with real thickness in it, for lashes that show across a room.',
    d: 'A volumising mascara with a plush hourglass brush and a wax-light formula that builds thickness without turning the lashes into a single black bar. Two coats take it from daytime to evening; three work if you have the patience. It holds a curl on straight lashes, which is rare.',
    de: 'Plush hourglass brush|Buildable thickness, no clumping|Holds a curl on straight lashes|Smudge-resistant through the day|Removes with a balm cleanser',
    sp: 'Finish~Dense black||Size~10 ml tube||Wear~12 hours||Brush~Hourglass plush||Removal~Cleansing balm',
    va: 'Shade~Black / Soft Black / Brown'
  },
  {
    n: 'Waterproof Mascara',
    s: 'The one for humid months, tears and long days by water.',
    d: 'A genuinely waterproof mascara that survives rain, swimming and a difficult film without running, and still comes off in one stroke with an oil-based cleanser. The brush is slim and the formula is drier, so work quickly and do not let coats sit. It is not for daily wear; lashes dry out.',
    de: 'True waterproof wear film|Survives swimming and humidity|Removes with an oil cleanser in one stroke|Slim brush for the lower lashes|Reserve for long and wet days',
    sp: 'Finish~Matte black||Size~9 ml tube||Wear~Waterproof||Brush~Slim comb||Removal~Oil-based cleanser',
    va: 'Shade~Black / Brown'
  },
  {
    n: 'Lash Primer',
    s: 'A white base coat that makes any mascara do more.',
    d: 'A fibres-and-wax primer applied before mascara that coats each lash, gives the colour underneath something to cling to, and adds visible length without a second tube. It sets in thirty seconds, so move quickly. It works equally well on bare lashes for a daytime lift.',
    de: 'Apply before mascara, in one pass|Sets in thirty seconds|Adds lift and length without weight|Also good alone for a daytime lash|Narrow brush for small lashes',
    sp: 'Finish~White base||Size~8 ml tube||Wear~Under mascara||Brush~Narrow||Removal~Warm water'
  },
  {
    n: 'Clear Brow Gel',
    s: 'A transparent gel that holds hairs up all day without going crunchy.',
    d: 'A flexible clear gel with a small, precise brush that grooms brows upward and keeps them there without flaking white into the hair. It holds fine, stubborn hairs through humidity and disappears entirely on the brow. Use it on dry hair, brushing against the growth first.',
    de: 'Flexible hold, never crunchy|No white flake on dry hair|Small stepped brush for short hairs|Transparent under or over colour|Brush against growth, then with',
    sp: 'Finish~Clear, natural||Size~7 ml tube||Hold~Medium flexible||Brush~Stepped mini wand||Free from~Fragrance'
  },
  {
    n: 'Tinted Brow Gel', nw: 1,
    s: 'Hold plus a soft wash of pigment for brows that are sparse at the tail.',
    d: 'A tinted gel that fills the look of a thin tail while keeping the hairs brushed up, with fibres fine enough not to read as a drawn line. Six tones cover most natural brow depths without going warm or orange. Apply thinly and comb through before it dries.',
    de: 'Tint and hold in one step|Fine fibres, no drawn-on look|Six natural brow tones|Comb through before it sets|Vegan formula',
    sp: 'Finish~Natural tint||Size~7 ml tube||Hold~Medium flexible||Shade range~6 tones||Brush~Stepped mini wand',
    va: 'Shade~Light Blonde / Warm Blonde / Taupe / Soft Brown / Deep Brown / Ash Black'
  },
  {
    n: 'Microfine Brow Pencil',
    s: 'A 1.5 mm tip for hair strokes, not for blocks of colour.',
    d: 'An ultra-fine brow pencil that draws individual hair strokes at the tail and gaps between hairs, then softens with a spoolie before anyone can tell. The core is firm enough not to snap under a light hand and matte on the skin. Choose a shade lighter than you think.',
    de: '1.5 mm microfine tip for hair strokes|Matte, skin-set pigment|Built-in spoolie on the cap|Firm core, resists snapping|Size up one shade lighter',
    sp: 'Finish~Matte hair stroke||Size~0.3 g pencil||Tip~1.5 mm fine||Shade range~7 shades||Tools~Spoolie cap',
    va: 'Shade~Ash Blonde / Warm Blonde / Taupe / Soft Brown / Chestnut / Deep Brown / Espresso'
  },
  {
    n: 'Brow Pomade Pot',
    s: 'A longwear pomade for brows that need structure, not just colour.',
    d: 'A concentrated pomade in a small pot, high in pigment and waterproof once dry, that lets you draw a crisp bottom edge and a soft top. A thin layer with an angled brush is the difference between groomed and severe. It is also the one that survives a beach holiday.',
    de: 'High pigment, waterproof once dry|Use with an angled brush|Crisp bottom edge, soft top|Small pot, months of use|Refillable glass pot',
    sp: 'Finish~Matte||Size~5 g pot||Wear~24 hour transfer-resistant||Shade range~5 shades||Brush~Angled',
    va: 'Shade~Taupe / Soft Brown / Chestnut / Deep Brown / Ash Black'
  },
  {
    n: 'Brow Setting Wax', nw: 1,
    s: 'A matte wax for the days you want brows brushed flat and unbothered.',
    d: 'A medium-hold matte wax that laminates brow hairs in place without shine or stiffness, the kind of finish you used to need a professional to get. The wand is short and stubby so it coats the roots rather than the tips. Apply on dry hair, then press down with a fingertip.',
    de: 'Matte laminate finish, no shine|Medium hold all day|Short wand coats the roots|Fragrance-free and vegan|Layer over powder for extra grip',
    sp: 'Finish~Matte||Size~6 ml tube||Hold~Medium||Brush~Short stubby wand||Free from~Fragrance'
  },

  // --- lips (9) ---
  {
    n: 'Satin Lipstick',
    s: 'A true-colour bullet with a satin glide and no ring of colour left behind.',
    d: 'A medium-pigment lipstick in a satin finish, made from a shea and jojoba base that glides rather than drags and wears off evenly instead of leaving a hard ring. One pass covers; a second deepens. It is the bullet to reach for when your lips have been over-exfoliated.',
    de: 'Satin finish, medium pigment|Shea and jojoba conditioning base|Wears off evenly, no ring|Refillable aluminium case|Twelve layerable shades',
    sp: 'Finish~Satin||Coverage~Medium||Weight~3.8 g bullet||Shade range~12 shades||Refill~Yes',
    va: 'Shade~Bare Rose / Warm Nude / Terracotta / True Red / Brick / Berry / Deep Plum / Brown Sugar'
  },
  {
    n: 'Matte Velvet Lipstick', oos: 1,
    s: 'A genuine matte that does not feel like paper on the lips.',
    d: 'A full-pigment matte bullet built with a soft-focus wax that keeps the finish flat and the feel comfortable for a good four hours. It blurs the lip line rather than outlining it, so feathering is rare. Blot once after the first pass and it will stay put through coffee.',
    de: 'Full pigment, flat matte finish|Soft-focus wax base|Blurs the lip line against feathering|Four to five hours of wear|Refillable case',
    sp: 'Finish~Matte||Coverage~Full||Weight~3.8 g bullet||Shade range~10 shades||Refill~Yes',
    va: 'Shade~Nude Leather / Warm Clay / Rust / Rosewood / Classic Red / Wine / Chestnut'
  },
  {
    n: 'Liquid Lip Colour',
    s: 'A transfer-resistant liquid matte that stops being sticky in a minute.',
    d: 'A flexible liquid matte that goes on comfortable, sets within sixty seconds and survives a masked afternoon without transferring in a line to the inside of the fabric. It is not a mousse and will not shrink into the lip lines as it dries. Remove it with an oil cleanser, not a wipe.',
    de: 'Transfer-resistant once set|Flexible film, no cracking|Does not shrink into lip lines|Six to eight hours of wear|Removes with oil, not scrubbing',
    sp: 'Finish~Matte||Coverage~Full||Size~6 ml applicator||Shade range~14 shades||Wear~6-8 hours',
    va: 'Shade~Petal Nude / Warm Cinnamon / Terracotta / Fig / Deep Berry / True Red / Brick Red / Espresso'
  },
  {
    n: 'Lip Liner Pencil',
    s: 'A blurring liner you can shade inward and no one will know why.',
    d: 'A cushioned lip pencil with a matte finish that defines the edge without drawing a line, then blends inward to deepen the middle of the lip. It works over balm and under lipstick equally well. Ten shades built to sit between real lip colours, not on top of them.',
    de: 'Defines without a hard edge|Shades inward for depth|Layerable over balm and under colour|Blurry matte finish|Ten in-between shades',
    sp: 'Finish~Matte blur||Size~1.2 g twist pencil||Shade range~10 shades||Tip~Medium point||Free from~Fragrance',
    va: 'Shade~Soft Nude / Warm Blush / Rosewood / Terracotta / Brick / Berry / Brown Sugar'
  },
  {
    n: 'Sheer Lip Gloss',
    s: 'A non-sticky gloss with a real tint and none of the drag.',
    d: 'A cushioned gloss in a flat wide applicator, made with jojoba and squalane so it sits on the lip rather than pulling at it when you talk. It has enough colour to be a lip product on its own and enough shine to layer over any bullet. It does not migrate into lines.',
    de: 'Cushioned, non-sticky oil base|Flat doe-foot applicator|Wear alone or over a bullet|Will not migrate into lip lines|Refillable glass tube',
    sp: 'Finish~High shine||Coverage~Sheer||Size~8 ml tube||Shade range~8 shades||Refill~Yes',
    va: 'Shade~Clear Glaze / Pearl Pink / Warm Peach / Rose Icing / Cola / Bare Berry'
  },
  {
    n: 'Velvet Lip Ink',
    s: 'A stain-thin pigment that leaves colour behind even after the gloss goes.',
    d: 'A watery, deeply pigmented lip ink that sinks into the surface of the lip and stays as a soft stain for hours after the top layer has worn off. Apply it thin and let it dry before anything else touches it. It is the closest thing to a lip that looks naturally coloured.',
    de: 'Watery, high-tint pigment|Leaves a long-wearing soft stain|Apply thin and let it dry|Weightless on the lip|Six shade stains',
    sp: 'Finish~Soft stain||Coverage~Sheer to medium||Size~5 ml dropper||Shade range~6 shades||Wear~4-6 hours stain',
    va: 'Shade~Rosewater / Warm Coral / Peony / Berry / Terracotta Stain'
  },
  {
    n: 'Cushion Lip Tint', nw: 1,
    s: 'A sponge-topped tint for the inside of the lip, blurred outward.',
    d: 'A soft blurring tint with a cushion applicator that presses colour into the centre of the lip and fades as it moves outward, which is how a natural flush actually behaves. It is lightly hydrating and completely sheer. Build in two passes rather than one heavy one.',
    de: 'Cushion applicator, centre-to-edge blur|Sheer, natural flush effect|Lightly hydrating, non-sticky base|Build in two thin passes|Vegan and fragrance-free',
    sp: 'Finish~Blurred satin||Coverage~Sheer||Size~6 ml cushion tube||Shade range~6 shades||Application~Cushion tip',
    va: 'Shade~Soft Pink / Warm Peach / Rose Clay / Berry Mist / Brown Blush'
  },
  {
    n: 'Cream Lip Colour',
    s: 'A one-pass cream bullet in twelve shades you can wear as a blush too.',
    d: 'A soft cream lipstick with medium coverage that applies in a single pass and can be tapped onto the cheeks when you are in a hurry. The finish is a low shine, the kind that photographs well on dry lips. It is the most forgiving formula in the range.',
    de: 'Single-pass medium coverage|Cream finish with low shine|Doubles as a cheek tint|Comfortable on dry or flaky lips|Refillable aluminium case',
    sp: 'Finish~Cream||Coverage~Medium||Weight~3.8 g bullet||Shade range~12 shades||Refill~Yes',
    va: 'Shade~Milk Tea / Soft Rose / Warm Nude / Peach Clay / Dusty Lilac / Fig / Cardinal'
  },
  {
    n: 'Longwear Lip Stain',
    s: 'A ten-hour stain in a flat shade, for days you will not see a mirror again.',
    d: 'A two-step stain with a pigment layer and a sealing balm layer that leaves a flat wash of colour behind long after the top has worn. It cannot be applied lazily; the edges matter. Once it has stained, eating changes very little about it.',
    de: 'Two steps, pigment then sealing balm|Longwear stain, not a film|Flat colour, no shine once set|Apply precisely, it does not move later|Removes with an oil cleanser',
    sp: 'Finish~Flat stain||Coverage~Medium||Size~4 ml dual-ended||Wear~Up to 10 hours||Shade range~7 shades',
    va: 'Shade~Warm Rose / Brick / Terracotta / Berry Ink / Deep Fig / Nude Rust'
  },

  // --- nails (4) ---
  {
    n: 'Nail Lacquer',
    s: 'A one-coat colour with a flattop brush and a week of wear.',
    d: 'A chip-resistant lacquer with a wide flattop brush that covers most nails in two strokes per side and dries to a hard gloss within ten minutes. The pigment load is high enough that one pass reads as a colour, not as a suggestion. It comes off with acetone and a cotton pad, no peeling.',
    de: 'Two-stroke coverage with a wide brush|Dries hard and glossy in ten minutes|Chip-resistant for up to seven days|Hypoallergenic twelve-free formula|Twelve wearable shades',
    sp: 'Finish~High gloss||Size~12 ml bottle||Wear~Up to 7 days||Brush~Wide flattop||Shade range~12 shades',
    va: 'Shade~Ballet Blush / Oxblood / Warm Taupe / Ink / Moss / Terracotta / Frosted Shell / Clear'
  },
  {
    n: 'Strengthening Base Coat',
    s: 'A protein base coat that stops the bending before the chipping starts.',
    d: 'A hardening base coat with keratin-derived protein and calcium that gives a soft nail something to push against, and gives colour a surface to hold. Worn alone it leaves a faint milky gloss. Use it under every lacquer and on bare nails between manicures.',
    de: 'Keratin-derived protein with calcium|Hardens flexible, peeling nails|Wears alone as a milky gloss|Extends lacquer wear|Formaldehyde-free',
    sp: 'Finish~Milky clear||Size~12 ml bottle||Use~Base coat, alone or under colour||Key Actives~Keratin protein, calcium||Free from~Formaldehyde, toluene'
  },
  {
    n: 'High Gloss Top Coat',
    s: 'A quick-dry top that keeps the shine past day four.',
    d: 'A fast-setting top coat that hardens the lacquer beneath it, adds real depth of shine and stops the tips wearing through by Thursday. Swipe a little along the free edge as well and it will hold the colour in. It does not thicken or go stringy in the bottle.',
    de: 'Sets in about two minutes|Deep gloss that outlasts the colour|Seal the free edge for fewer chips|Stays thin in the bottle|No yellowing over pale shades',
    sp: 'Finish~Wet-look gloss||Size~12 ml bottle||Dry time~About 2 minutes||Use~Top coat||Free from~Formaldehyde, toluene'
  },
  {
    n: 'Cuticle and Nail Oil',
    s: 'A pen of fractionated coconut and jojoba for the skin around the nail.',
    d: 'A brush-tipped oil pen with fractionated coconut oil, jojoba and vitamin E that sinks into the cuticle without leaving your hands slippery an hour later. It keeps the ridge and hangnail look away between manicures. Carry one and use it while reading, not only after polish.',
    de: 'Fast-absorbing fractionated coconut base|Jojoba with vitamin E|Brush tip, no messy bottle|Use daily around the cuticle|Refillable pen',
    sp: 'Size~8 ml refillable pen||Key Actives~Jojoba, fractionated coconut oil, vitamin E||Finish~Dry oil, no residue||Use~Daily||Refill~Yes'
  }
];

/* ------------------------------------------------------------------ *
 * HAIRCARE — 40
 * ------------------------------------------------------------------ */
const HAIRCARE = [
  // --- shampoos (10) ---
  {
    n: 'Daily Cream Shampoo',
    s: 'A sulphate-free cream wash for hair that gets dry at the ends.',
    d: 'A gentle, sulphate-free cream shampoo that cleans the scalp without squeezing the lengths dry, built on a mild surfactant blend with panthenol. It barely lathers, which takes about a week to get used to. Use it on the scalp only and let the suds run down on the rinse.',
    de: 'Sulphate-free, low-foam cleansing|Panthenol and glycerin in the base|Scalp application only|Safe for colour-treated hair|Alternate-day use',
    sp: 'Size~300 ml bottle||Hair Type~Dry, normal, colour-treated||Key Actives~Panthenol, glycerin||Surfactant~Sulphate-free||pH~5.5',
    va: 'Size~100 ml travel / 300 ml / 500 ml refill'
  },
  {
    n: 'Clarifying Reset Shampoo',
    s: 'A clear wash with charcoal for the week of dry shampoo and hard water.',
    d: 'A clarifying shampoo with activated charcoal and a chelating agent that lifts mineral build-up, silicones and the residue of a long dry-shampoo streak. It is not a daily habit; use it once a fortnight and follow with a mask. Hair squeaks clean in the good sense, not the straw sense.',
    de: 'Removes mineral and silicone build-up|Activated charcoal with a chelating agent|Once every one to two weeks|Follow with a conditioner or mask|Not for daily use',
    sp: 'Size~250 ml bottle||Hair Type~Oily, product build-up||Key Actives~Charcoal, EDTA chelator||Use~Fortnightly||Surfactant~Cleansing blend'
  },
  {
    n: 'Scalp Renewal Shampoo', ft: 1,
    s: 'Zinc and salicylic acid for a scalp that flakes and itches in winter.',
    d: 'A cleansing shampoo with zinc PCA and 2 per cent salicylic acid that helps clear the look of flakes and settles the itch of a tight, reactive scalp. Leave it on for a minute before rinsing, then condition the lengths only. Use it three times a week through the cold months.',
    de: 'Zinc PCA with 2 per cent salicylic acid|Helps clear the look of flakes|Hold for sixty seconds before rinsing|Condition lengths only afterwards|Three times weekly in winter',
    sp: 'Size~250 ml bottle||Hair Type~Oily scalp, flaking||Key Actives~Zinc PCA, salicylic acid||Use~3 weekly||Fragrance~Fresh, light'
  },
  {
    n: 'Volumising Rice Protein Shampoo',
    s: 'A light wash with rice protein that lifts fine hair off the head.',
    d: 'A weightless shampoo fortified with hydrolysed rice protein, which temporarily thickens the individual strand so fine hair holds shape at the crown. It cleans thoroughly and leaves nothing coating the hair. Alternate with a moisture shampoo, since protein every day goes stiff.',
    de: 'Hydrolysed rice protein for body|Weightless, no coating residue|Lifts the crown within one wash|Alternate with a moisturising wash|Sulphate-free base',
    sp: 'Size~300 ml bottle||Hair Type~Fine, flat, oily roots||Key Actives~Rice protein, panthenol||Surfactant~Sulphate-free||Finish~Body, not stiff',
    va: 'Hair Type~Fine / Wavy / Straight'
  },
  {
    n: 'Colour Care Shampoo',
    s: 'A gentle, slightly acidic wash that keeps a colour from running.',
    d: 'A colour-safe shampoo formulated at a low pH with camellia oil and green tea, so the cuticle stays closed and the pigment stays inside it. It is mild enough for daily use on bleached hair. Wash the scalp and let the ends be cleaned by nothing but the runoff.',
    de: 'Low pH, cuticle-friendly|Camellia oil with green tea|Safe on bleached and fashion colour|Daily use|Sulphate-free',
    sp: 'Size~300 ml bottle||Hair Type~Colour-treated, bleached||Key Actives~Camellia oil, green tea||pH~4.5||Surfactant~Sulphate-free'
  },
  {
    n: 'Oat Comfort Shampoo',
    s: 'A milk-soft wash for a scalp that burns after every other shampoo.',
    d: 'A milky, ultra-mild shampoo with colloidal oatmeal and squalane for scalps that go hot and tight under ordinary surfactants. It cleans lightly and honestly, which is often all a dry scalp needs. Skip it on the days you use the renewal shampoo.',
    de: 'Colloidal oatmeal with squalane|For sensitive, dry, reactive scalps|Very low foam|Fragrance-free|Use on non-treatment days',
    sp: 'Size~250 ml bottle||Hair Type~Dry, sensitive scalp||Key Actives~Colloidal oatmeal, squalane||Fragrance~None||Foam~Low'
  },
  {
    n: 'Caffeine Density Shampoo',
    s: 'A stimulating wash with caffeine and niacinamide for a thinning look.',
    d: 'A daily shampoo with caffeine, niacinamide and rice peptide that supports the look of denser, fuller hair at the crown by keeping the scalp itself clean and unhindered. It will not regrow anything, and we would rather say that than promise it. Massage for a minute, then rinse.',
    de: 'Caffeine with niacinamide and rice peptide|Supports the look of fuller hair|Clarifies without stripping|Daily use|Massage one minute before rinsing',
    sp: 'Size~250 ml bottle||Hair Type~Fine, thinning appearance||Key Actives~Caffeine, niacinamide, rice peptide||Use~Daily||Fragrance~Woody, light'
  },
  {
    n: 'Curl Cleansing Co-Wash',
    s: 'A conditioning wash for curls that cannot survive shampoo twice a week.',
    d: 'A co-wash that lifts dust and light oil from curly hair without the foam that leaves it frizzy and expanded. It is formulated to rinse fully, which ordinary conditioner never quite does. Use it between shampoos, on the mid-lengths and ends, and always on soaking wet hair.',
    de: 'No-foam conditioning cleanse|Rinses fully, no buildup|For coily, curly and wavy hair|Use between shampoo days|Apply to very wet hair',
    sp: 'Size~250 ml bottle||Hair Type~Curly, coily, dry||Key Actives~Behentrimonium chloride, glycerin||Surfactant~None, co-wash||Use~Between shampoos',
    va: 'Hair Type~Wavy / Curly / Coily'
  },
  {
    n: 'Post-Workout Scalp Shampoo',
    s: 'A light clarifying wash for the gym bag and the sweat on the scalp.',
    d: 'A low-foam gel shampoo with willow bark extract and mint that takes sweat, salt and odour off the scalp after a session without drying out the lengths. The bottle is small enough to live in a gym kit permanently. Rinse once, wash, rinse again, and be out of the shower in three minutes.',
    de: 'Willow bark with a touch of mint|Removes sweat, salt and odour|Travel-sized for a gym kit|Three-minute shower wash|Use on the scalp only',
    sp: 'Size~180 ml bottle||Hair Type~All, active lifestyles||Key Actives~Willow bark, menthol||Fragrance~Fresh mint||Use~After exercise',
    va: 'Size~60 ml / 180 ml'
  },
  {
    n: 'Bond Care Strengthening Shampoo', nw: 1,
    s: 'A protein-light wash for hair that snaps at the mid-lengths.',
    d: 'A strengthening shampoo with a peptide complex and a small amount of hydrolysed protein, built for hair that has been heat-styled and bleached into brittleness. It supports the look of fewer breakages over six weeks, which is a slow and honest claim. Follow with the bond masque once a week.',
    de: 'Peptide complex with light protein|For over-processed, brittle hair|Reduces the look of breakage over weeks|Sulphate-free|Pair with the bond masque',
    sp: 'Size~250 ml bottle||Hair Type~Damaged, bleached, heat-styled||Key Actives~Peptide complex, rice protein||Surfactant~Sulphate-free||Use~Regularly'
  },

  // --- conditioners (6) ---
  {
    n: 'Daily Moisture Conditioner',
    s: 'A mid-weight cream that detangles without making hair lie flat.',
    d: 'A everyday conditioner with cetyl alcohol, glycerin and a little squalane that gives slip where it is needed and rinses out clean. It is the one to hand to whoever keeps borrowing your products. Apply from the ears down, leave two minutes, rinse cool.',
    de: 'Mid-weight cream for everyday use|Apply from the ears down only|Rinses clean, never coats|Two minutes, then cool water|Safe on fine hair',
    sp: 'Size~250 ml bottle||Hair Type~Normal, dry||Key Actives~Cetyl alcohol, squalane, glycerin||Use~Every wash||Contact time~2 minutes'
  },
  {
    n: 'Slip Detangling Conditioner',
    s: 'Serious slip for knots, kids and anyone with a wide-tooth comb.',
    d: 'A thick, high-slip conditioner that turns a brushing session from a negotiation into a ninety-second job. It works on damp hair with a wide-tooth comb, starting at the ends and working upward. It is heavy, so keep it well away from the roots.',
    de: 'High-slip formula for knots|Comb from the ends upward|Use on damp hair only|Keep away from the roots|Also good on wet tangles after swimming',
    sp: 'Size~300 ml bottle||Hair Type~Thick, tangled, curly||Key Actives~Behentrimonium chloride, panthenol||Contact time~3 minutes||Use~Every wash'
  },
  {
    n: 'Weightless Conditioner for Fine Hair',
    s: 'A watery conditioner that does the job and then leaves.',
    d: 'A thin, water-based conditioner with hydrolysed rice protein and panthenol, made for hair that goes flat under anything creamier. It detangles lightly and rinses out with no film at all. A hazelnut amount on the ends is the entire dose.',
    de: 'Watery, film-free rinse|Hydrolysed rice protein|Ends only, a hazelnut amount|Will not weigh fine hair down|Layer under a leave-in if needed',
    sp: 'Size~250 ml bottle||Hair Type~Fine, flat, oily roots||Key Actives~Rice protein, panthenol||Texture~Watery cream||Use~Every wash'
  },
  {
    n: 'Curl Defining Conditioner',
    s: 'A rich rinse that leaves curls clumped, shaped and not frizzed.',
    d: 'A conditioning cream with shea and camellia oil that encourages curls to form into proper clumps rather than a cloud. Detangle it in with fingers under running water, then rinse partly, leaving a little behind. It is the base of a good wash day for textured hair.',
    de: 'Encourages curl clumping|Shea butter with camellia oil|Detangle with fingers under water|Rinse partially for more definition|Suits wavy to coily',
    sp: 'Size~300 ml bottle||Hair Type~Wavy, curly, coily||Key Actives~Shea butter, camellia oil||Rinse~Partial||Use~Every wash',
    va: 'Hair Type~Wavy / Curly / Coily'
  },
  {
    n: 'Colour Shield Conditioner',
    s: 'A slightly acidic conditioner that keeps dye from leaching out.',
    d: 'A low-pH conditioner with green tea and camellia that keeps the cuticle closed after a salon visit and slows the fade of fashion shades. It slips well enough for bleached hair without softening it into mush. Use it on every wash for the first month after colouring.',
    de: 'pH 4.5 to hold the cuticle closed|Antioxidant green tea for fade|Slip enough for bleached hair|Daily through the first month after colour|Sulphate-free and paraben-free',
    sp: 'Size~250 ml bottle||Hair Type~Colour-treated, bleached||Key Actives~Green tea, camellia oil||pH~4.5||Use~Every wash'
  },
  {
    n: 'Keratin Repair Conditioner',
    s: 'A protein conditioner for hair that stretches when it is wet.',
    d: 'A conditioner with hydrolysed keratin and amino acids that temporarily fills in the porous patches of over-processed hair, so it stops going limp and elastic when wet. Use it in cycles, two weeks on and two off, because too much protein makes hair brittle rather than strong. Follow with moisture on the other washes.',
    de: 'Hydrolysed keratin with amino acids|For hair that stretches when wet|Cycle two weeks on, two off|Follow with a moisture conditioner between|Focus on the most damaged lengths',
    sp: 'Size~250 ml bottle||Hair Type~Damaged, bleached, high porosity||Key Actives~Hydrolysed keratin, amino acids||Use~Cycled, 2 weekly||Contact time~3 minutes'
  },

  // --- hair oils (5) ---
  {
    n: 'Argan and Camellia Hair Oil', ft: 1,
    s: 'Two cold-pressed oils, one pump, and no grease on the pillow.',
    d: 'A blend of argan and camellia oils light enough to use on damp hair before drying and on dry ends mid-afternoon. One pump warmed between the palms takes the frizz down without making the hair look unwashed. It has no silicone in it, which is why it needs reapplying rather than building up.',
    de: 'Cold-pressed argan and camellia|One pump on damp or dry ends|Silicone-free, so no buildup|Warm between the palms first|Safe before heat styling at low heat',
    sp: 'Size~50 ml pump||Hair Type~Dry, frizzy, thick||Key Actives~Argan oil, camellia oil||Fragrance~Nutty, natural||Use~Damp or dry ends',
    va: 'Size~30 ml / 50 ml'
  },
  {
    n: 'Scalp Oil, Vetiver and Cedar',
    s: 'A pre-wash scalp oil with vetiver for dryness and a slow evening scent.',
    d: 'A light pre-wash oil of fractionated coconut, jojoba and a real vetiver and cedar distillate that loosens flaky buildup on a Sunday night and smells like a good library. Massage a dropper into the partings, leave an hour, then shampoo twice. It is not a leave-in; the scalp will tell you.',
    de: 'Pre-wash treatment, one to two hours|Fractionated coconut with jojoba|Vetiver and cedar, naturally scented|Shampoo twice afterwards|Use weekly',
    sp: 'Size~60 ml dropper||Hair Type~Dry, flaky scalp||Key Actives~Jojoba, fractionated coconut oil||Fragrance~Vetiver, cedar||Use~Weekly pre-wash'
  },
  {
    n: 'Lightweight Shine Oil',
    s: 'A dry oil in a spray for fine hair that cannot carry weight.',
    d: 'A mist of fractionated coconut oil and a small amount of camellia that gives fine hair a surface shine and a little slip without a single visible drop of grease. Spray it onto the palms, then run them over the mid-lengths. It is also the right oil for the days you wore too much of the rich one.',
    de: 'Dry-touch oil mist|Fine hair safe, no weighting|Apply to palms, then to lengths|Silicone-free|Also tames a flyaway parting',
    sp: 'Size~100 ml spray||Hair Type~Fine, thin, low volume||Key Actives~Fractionated coconut oil, camellia||Fragrance~None||Format~Fine oil mist'
  },
  {
    n: 'Overnight Ritual Oil',
    s: 'A heavier pressing of marula and rice bran for very dry, coarse hair.',
    d: 'Marula, rice bran and a little castor oil in an overnight treatment oil for coarse, high-porosity hair that drinks everything it is given. Warm a teaspoon, work it through the lengths, braid loosely and wash it out in the morning. It softens the look of roughness from the first week.',
    de: 'Overnight treatment, rinse out in the morning|Marula, rice bran and castor oils|Warm a teaspoon before applying|Braid loosely to keep it off the pillow|For coarse and very dry hair',
    sp: 'Size~100 ml bottle||Hair Type~Coarse, very dry, high porosity||Key Actives~Marula oil, rice bran oil||Use~Weekly overnight||Fragrance~Warm, natural'
  },
  {
    n: 'Hair Mist, Neroli and Bergamot',
    s: 'A scent for the hair that does not contain the alcohol of a perfume.',
    d: 'A light fragrance mist with neroli and bergamot in a glycerin-and-water base, made to sit on the hair rather than the skin, where alcohol would be a problem. It holds for a few hours and takes the shape of whatever perfume you are wearing underneath. Spray the brush, not the head.',
    de: 'Alcohol-light base for hair|Neroli with bergamot top|Spray onto a brush and comb through|Lasts a few hours|Safe on colour-treated hair',
    sp: 'Size~100 ml spray||Fragrance family~Citrus floral||Top notes~Bergamot, neroli||Longevity~2-4 hours||Base~Glycerin and water'
  },

  // --- masks (4) ---
  {
    n: 'Shea and Marula Hair Masque',
    s: 'A ten-minute masque that turns a straw-like feel back into hair.',
    d: 'A dense masque with shea butter, marula oil and cetyl alcohol that softens dry, rough lengths in about ten minutes under warm water. Use it weekly on the mid-lengths and ends, never the scalp. It is thick enough that a wide-tooth comb does the distributing for you.',
    de: 'Weekly ten-minute treatment|Shea butter with marula oil|Mid-lengths and ends only|Comb through for even distribution|Rinse with warm, then cool water',
    sp: 'Size~200 ml jar||Hair Type~Dry, coarse, damaged||Key Actives~Shea butter, marula oil||Contact time~10 minutes||Use~Weekly'
  },
  {
    n: 'Keratin Smooth Mask', oos: 1,
    s: 'A protein mask for the weeks between straightening services.',
    d: 'A smoothing masque with hydrolysed keratin and amino acids that temporarily flattens the surface of porous hair, so it dries straighter and frizzes less in humidity. Fifteen minutes with a shower cap, then a thorough rinse. Alternate it with a moisture masque; protein alone will make hair snap.',
    de: 'Hydrolysed keratin with amino acids|Fifteen minutes under a cap|Dries straighter, frizzes less|Alternate with a moisture masque|Rinse thoroughly, no residue left',
    sp: 'Size~200 ml jar||Hair Type~Porous, frizzy, chemically treated||Key Actives~Hydrolysed keratin, amino acids||Contact time~15 minutes||Use~Fortnightly'
  },
  {
    n: 'Clay Scalp Purifying Mask',
    s: 'A kaolin scalp paste for the week the roots go flat by Tuesday.',
    d: 'A cooling kaolin and zinc mask that you paint onto the partings, leave for ten minutes and rinse out before it dries into a mess. It lifts oil and product buildup from the scalp and leaves the roots visibly lighter. Keep it away from the lengths, which it will only dry.',
    de: 'Kaolin clay with zinc PCA|Apply to the partings on dry hair|Ten minutes, rinse before it hardens|Roots look lighter afterwards|Use every one to two weeks',
    sp: 'Size~150 ml tube||Hair Type~Oily roots, flat hair||Key Actives~Kaolin, zinc PCA||Contact time~10 minutes||Use~Fortnightly'
  },
  {
    n: 'Bond Repair Masque',
    s: 'The weekly intensive for hair that has been through too much bleach.',
    d: 'A peptide-and-protein masque formulated to support the look of strength in hair that has been lightened repeatedly, with a conditioning base so it never goes stiff. Twenty minutes on damp lengths, then rinse. It cannot rebuild what has been removed, but it does make the last two inches survivable.',
    de: 'Peptide complex with light protein|Twenty minutes on damp lengths|Conditioning base, never stiffening|For heavily lightened hair|Use weekly, then fortnightly',
    sp: 'Size~200 ml jar||Hair Type~Bleached, chemically damaged||Key Actives~Peptide complex, amino acids||Contact time~20 minutes||Use~Weekly'
  },

  // --- leave-in and styling (9) ---
  {
    n: 'Leave-In Cream',
    s: 'A light everyday cream for damp hair, comb-through soft.',
    d: 'A milky leave-in with panthenol, glycerin and a small amount of cetyl alcohol that keeps damp hair manageable until it dries and then does nothing visible. It is the right first product for anyone who has never used one. A coin-size for shoulder-length hair, more for more.',
    de: 'Milky, lightweight leave-in|Coin-size for shoulder-length hair|Apply to towel-damp hair|No weighing down or crunch|Safe daily',
    sp: 'Size~150 ml pump||Hair Type~Normal, dry, wavy||Key Actives~Panthenol, glycerin||Use~After washing||Hold~None, care only'
  },
  {
    n: 'Detangling Mist',
    s: 'A spray for dry hair, knots and the eight in the morning brushing session.',
    d: 'A watery mist with a small amount of conditioning agent that gives dry, knotted hair enough slip to comb through without pulling chunks out. It dries weightless, so it works on second-day hair as well as wet. Spray, wait thirty seconds, then comb from the ends upward.',
    de: 'Spray on dry or damp hair|Slip without weight or residue|Comb from the ends upward|Safe on second-day hair|Fine mist, no stick',
    sp: 'Size~200 ml spray||Hair Type~Tangled, dry, thick||Key Actives~Panthenol, lightweight conditioner||Use~Dry or damp||Finish~Weightless'
  },
  {
    n: 'Heat Protectant Cream',
    s: 'A blow-dry cream that shields up to 200 degrees and speeds the dry.',
    d: 'A styling cream with a heat-shielding polymer and squalane that cuts blow-drying time noticeably and keeps the straightening iron from grabbing. It is comfortable on damp hair and never flakes once dry. Use it every single time you apply heat, without exception.',
    de: 'Protects up to 200 C styling heat|Reduces blow-dry time|No flaking once dry|Apply to towel-damp hair|Use with every heat session',
    sp: 'Size~150 ml tube||Hair Type~All||Key Actives~Heat-shielding polymer, squalane||Heat protection~Up to 200 C||Use~Before blow-drying'
  },
  {
    n: 'Curl Defining Cream',
    s: 'A shaping cream that keeps the pattern and leaves the crunch out.',
    d: 'A defining cream with shea and a light hold that encourages curl clumps, dries soft and refuses to leave a cast unless you scrunch it out. Apply it soaking wet, in sections, raking then scrunching. On wavy hair, use half the amount you think you need.',
    de: 'Soft finish with no cast|Apply to soaking wet hair in sections|Rake then scrunch for clumps|Shea butter with light hold|Half the amount on waves',
    sp: 'Size~200 ml tub||Hair Type~Wavy, curly, coily||Key Actives~Shea butter, glycerin||Hold~Light, flexible||Finish~Soft',
    va: 'Hold~Light / Medium'
  },
  {
    n: 'Anti-Frizz Hair Serum',
    s: 'A silicone-smooth serum that stops humidity winning the argument.',
    d: 'A concentrated serum with cyclomethicone and argan oil that flattens the frizz halo on damp or dry hair and holds it through a humid day. Two drops is a full head; more simply makes the lengths look flat and oily. It sits on the surface and washes out with a clarifying shampoo.',
    de: 'Two drops for the whole head|Damp or dry hair application|Holds against humidity|Surface silicones, washes out fully|Keep well away from the roots',
    sp: 'Size~50 ml pump||Hair Type~Frizzy, thick, high porosity||Key Actives~Cyclomethicone, argan oil||Finish~Smooth gloss||Use~Damp or dry'
  },
  {
    n: 'Sea Salt Texture Spray',
    s: 'Grit and volume for hair that dries too polite.',
    d: 'A light salt-and-sugar spray with a little algae extract that gives straight or wavy hair the piece-y texture of a day spent near water. Scrunch it into damp hair or refresh dry lengths with a mist. It will dry out very porous hair if used daily, so alternate days.',
    de: 'Marine salt with algae extract|Scrunch into damp or mist onto dry|Adds grit, not hold|Alternate days on dry hair|Suits straight to wavy',
    sp: 'Size~150 ml spray||Hair Type~Straight, wavy, fine||Key Actives~Sea salt, algae extract||Hold~None, texture only||Finish~Matte grit'
  },
  {
    n: 'Rice Starch Dry Shampoo', nw: 1,
    s: 'A translucent rice powder that absorbs oil and leaves no white head.',
    d: 'A dry shampoo milled from rice starch rather than the usual aerosol powders, so it absorbs oil at the root and blends to nothing on dark hair. It comes in a pump, which means no propellant and no cloud in a small bathroom. Two sprays per section, then massage it in.',
    de: 'Rice starch, no aerosol propellant|Translucent on deep tones|Massage in after spraying|Two pumps per section|Leaves no chalky buildup',
    sp: 'Size~120 ml pump||Hair Type~All, oily roots||Key Actives~Rice starch, clay||Finish~Invisible matte||Format~Pump powder'
  },
  {
    n: 'Flexible Hold Styling Gel',
    s: 'A gel that holds a shape and then lets you move your head.',
    d: 'A water-based gel with a flexible film that keeps a fringe down or a parting crisp without going glassy, and washes out in a single rinse. It works on dry hair for edge control and on damp hair for shape. Use a pea-size, not the handful the tube encourages.',
    de: 'Flexible, non-crunchy film|Water-based, rinses out fully|Works on damp or dry hair|Pea-size is the dose|No flaking as it dries',
    sp: 'Size~200 ml tube||Hair Type~All||Key Actives~PVP film-former, panthenol||Hold~Medium flexible||Finish~Natural',
    va: 'Hold~Light / Medium / Strong'
  },
  {
    n: 'Glossing Shine Spray',
    s: 'A fine mist for hair that looks matte under office lighting.',
    d: 'A light spray of fractionated coconut oil and a hydrolysed protein that puts a real reflection back on dull lengths for a day and then washes away. Mist it at a distance onto dry hair and comb once through. It is a cosmetic shine, not a treatment, and it is honest about it.',
    de: 'Fine mist, one-day cosmetic shine|Comb through once after misting|Washes out, no buildup|Safe on fine hair|Also good on the ends after styling',
    sp: 'Size~100 ml spray||Hair Type~All, dull lengths||Key Actives~Fractionated coconut oil, rice protein||Finish~Gloss||Use~On dry hair'
  },

  // --- scalp treatments (4) ---
  {
    n: 'Scalp Serum with Peptide and Caffeine', nw: 1,
    s: 'A dropper-to-the-parting serum for the look of a healthier scalp.',
    d: 'A lightweight leave-on serum with a peptide complex, caffeine and niacinamide that keeps the scalp comfortable and supports the look of denser-looking hair over three months of nightly use. The nozzle puts product onto the parting, not into the hair. It does not sting, and it does not smell medicinal.',
    de: 'Apply to clean, dry partings|Peptide complex with caffeine and niacinamide|Nightly for at least 12 weeks|Non-greasy, no residue in the hair|Patch test first, as with any active',
    sp: 'Size~60 ml dropper||Hair Type~Fine, thinning appearance||Key Actives~Peptide complex, caffeine, niacinamide||Use~Nightly, leave-on||Fragrance~None'
  },
  {
    n: 'Exfoliating Scalp Lotion',
    s: 'Salicylic acid in a runny lotion for buildup that shampoo will not shift.',
    d: 'A thin 2 per cent salicylic acid lotion applied to dry partings twice a week, which loosens the compacted oil and flakes ordinary washing leaves behind. Leave it overnight or for two hours, then shampoo out. Expect a little more shedding in the first fortnight, which is the buildup going.',
    de: '2 per cent salicylic acid, leave-on|Apply to dry partings twice weekly|Leave two hours or overnight|Shampoo out afterwards|Extra shedding early is expected',
    sp: 'Size~100 ml applicator bottle||Hair Type~Flaky, congested scalp||Key Actives~Salicylic acid 2 per cent||Use~2 weekly||Strength~2 per cent'
  },
  {
    n: 'Pre-Wash Scalp Treatment',
    s: 'An oil-and-clay paste that lifts buildup before the water runs.',
    d: 'A pre-wash paste of bentonite, squalane and willow bark that you work into the scalp on dry hair, leave for fifteen minutes and then shampoo away twice. It pulls compacted oil out of the follicle opening rather than scrubbing at it. Use it monthly, or fortnightly on very oily scalps.',
    de: 'Bentonite with squalane and willow bark|Fifteen minutes on dry hair|Shampoo twice afterwards|Monthly, or fortnightly if very oily|Do not apply to broken skin',
    sp: 'Size~120 ml tube||Hair Type~Oily, congested scalp||Key Actives~Bentonite, willow bark, squalane||Contact time~15 minutes||Use~Monthly'
  },
  {
    n: 'Post-Wash Scalp Tonic',
    s: 'A cooling tonic of menthol and panthenol for the shower exit.',
    d: 'A watery leave-on tonic with a low level of menthol, panthenol and green tea that cools a hot, tight scalp straight out of the shower and dries without leaving the hair looking wet. It is fragrance-light and safe to use daily on the days you wash. Press it in with fingertips, do not soak the lengths.',
    de: 'Leave-on, applied to a clean scalp|Menthol with panthenol and green tea|Cooling within seconds|Dries without a wet look|Press in, do not soak the lengths',
    sp: 'Size~100 ml applicator spray||Hair Type~All scalps||Key Actives~Menthol, panthenol, green tea||Use~After washing, daily||Fragrance~Light, cool'
  },

  // --- clarifying and tone (2) ---
  {
    n: 'Hair UV Mist', nw: 1,
    s: 'Sunscreen for the hair, because colour does not survive a beach either.',
    d: 'A fine protective mist with a light UV filter and hydrolysed protein that shields the lengths on exposed days, the part of the hair routine almost nobody does. Mist it onto dry hair before going out and reapply after swimming. It leaves no stiffness and no scent worth mentioning.',
    de: 'UV filtering mist for lengths|Reapply after swimming|No stiffness, no film|Safe on colour-treated hair|Use before sun exposure',
    sp: 'Size~150 ml spray||Hair Type~All, colour-treated||Key Actives~UV filter, rice protein||Fragrance~Very light||Use~Before sun exposure'
  },
  {
    n: 'Blonde Tone Shampoo', oos: 1,
    s: 'A violet-pigmented wash that keeps bleach from going brassy.',
    d: 'A toning shampoo with direct violet pigment that pulls the yellow out of bleached, grey and highlighted hair over three minutes. Two uses a week is plenty; more turns the ends lilac, which washes out but is not the plan. Condition the ends afterwards, because toning shampoos are drying.',
    de: 'Direct violet pigment for brass|Leave three minutes, then rinse|Two uses weekly at most|Overuse gives a lilac cast|Follow with a rich conditioner',
    sp: 'Size~250 ml bottle||Hair Type~Bleached, blonde, grey||Key Actives~Violet pigment||Use~2 weekly||Contact time~3 minutes'
  }
];

/* ------------------------------------------------------------------ *
 * PERFUMES — 30
 * ------------------------------------------------------------------ */
const PERFUMES = [
  {
    n: 'Ivory Thread Eau de Parfum', ft: 1,
    s: 'Iris, ambrette and white musk, worn close enough to need leaning in.',
    d: 'Ivory Thread opens on powdered iris and cold musk and stays there, a skin scent with structure rather than a trail. Orris butter gives it a soft, slightly carrot-like depth that never goes sweet. It is the quietest bottle in the range and the one people ask about on the second day.',
    de: 'Iris pallida orris butter as the heart|Ambrette seed for a clean, cottony musk|Reads closer to skin in the first hour, then softens|Best layered over an unscented moisturiser|Hand-decanted refill available',
    sp: 'Concentration~Eau de parfum 18 per cent||Volume~50 ml||Longevity~6-8 hours on skin||Sillage~Close, intimate||Notes~Iris, ambrette, white musk||Family~Powdery musk',
    va: 'Size~10 ml travel / 30 ml / 50 ml / 100 ml'
  },
  {
    n: 'Vetiver Hour Eau de Parfum',
    s: 'Smoke, grapefruit peel and a root that is dry rather than earthy.',
    d: 'A Haiti-derived vetiver kept green and airy with grapefruit peel and a little cedar, so it reads like an outdoor evening rather than a barbershop. It gains a faint smudge of tobacco after an hour and holds that shape until the sixth. Strongly seasonal in autumn and winter.',
    de: 'Haitian vetiver root, dry and green|Grapefruit peel keeps the opening bright|A faint tobacco shadow after an hour|Projects for two hours, then sits closer|Spray on clothing for longer wear',
    sp: 'Concentration~Eau de parfum 20 per cent||Volume~50 ml||Longevity~7-9 hours||Sillage~Moderate||Notes~Vetiver, grapefruit, cedar||Family~Woody aromatic',
    va: 'Size~10 ml travel / 30 ml / 50 ml / 100 ml'
  },
  {
    n: 'Amber Ledger Eau de Parfum',
    s: 'Warm resin, labdanum and a low hum of vanilla that never turns gourmand.',
    d: 'A dry amber built on labdanum, benzoin and a trace of vanilla, weighted with immortelle so it stays resinous instead of dessert-like. It is warm in the way a room is warm after the fire has gone down. Excellent in cold weather and overpowering in a small lift.',
    de: 'Labdanum and benzoin resin heart|Immortelle adds a curry-leaf bitterness|Only a trace of vanilla, no sweetness|Longest-wearing of the amber line|Two sprays is honest behaviour',
    sp: 'Concentration~Eau de parfum 20 per cent||Volume~50 ml||Longevity~9-11 hours||Sillage~Strong for two hours||Notes~Labdanum, benzoin, immortelle||Family~Amber resinous',
    va: 'Size~10 ml travel / 30 ml / 50 ml / 100 ml'
  },
  {
    n: 'Skin Musk Eau de Toilette',
    s: 'A clean-skin scent: musk, a little aldehydic air, nothing else.',
    d: 'A short list of white musks with a soft aldehydic lift, made to smell like warm skin that has just been washed. It has no top note worth describing and does not pretend otherwise. Wear it under another perfume and it will make that perfume last longer.',
    de: 'Blended white musk accord|Soft aldehydic opening, soapy not powdery|Deliberately short-list formula|Excellent as a layering base|Safe around sensitive colleagues',
    sp: 'Concentration~Eau de toilette 12 per cent||Volume~50 ml||Longevity~4-6 hours||Sillage~Close||Notes~White musk, aldehydes||Family~Musk skin scent'
  },
  {
    n: 'Neroli Dawn Eau de Toilette',
    s: 'Orange blossom taken seriously: green, honeyed and briefly bitter.',
    d: 'Tunisian neroli distillate with a green petitgrain edge and a small amount of honeyed orange flower absolute, so the citrus never collapses into soap. It is bright for twenty minutes and then turns soft and skin-adjacent. The only true daytime floral in the collection.',
    de: 'Tunisian neroli distillate|Petitgrain keeps the opening green|A trace of honeyed orange flower absolute|Fades sooner than the heavier flacons|Reapply from a travel size at midday',
    sp: 'Concentration~Eau de toilette 14 per cent||Volume~50 ml||Longevity~4-6 hours||Sillage~Soft to moderate||Notes~Neroli, petitgrain, orange flower||Family~Citrus floral',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Bergamot Report Eau de Toilette',
    s: 'A cologne for people who like citrus, and then want it to last.',
    d: 'Calabrian bergamot with lemon peel, a mineral ambergris accord and a dry cedar tail, structured so the citrus survives the first hour instead of vanishing in it. It is the scent of a clean shirt in a warm room. Keep it refrigerated in summer and use it freely.',
    de: 'Calabrian bergamot and lemon peel|Ambroxan for a mineral, saline tail|Dry cedar keeps the base honest|A cologne that outlasts most colognes|Pleasant on skin and on cotton',
    sp: 'Concentration~Eau de toilette 12 per cent||Volume~50 ml||Longevity~5-7 hours||Sillage~Moderate||Notes~Bergamot, ambroxan, cedar||Family~Citrus aromatic'
  },
  {
    n: 'Sandal Silence Eau de Parfum',
    s: 'Creamy sandalwood with saffron on top and almost nothing else.',
    d: 'Australian sandalwood in a soft, milky register, lifted with a thread of saffron and held by tonka. There is no smoke here and no leather; it is the smooth end of the wood family. It settles into a second skin by the third hour and stays there all day.',
    de: 'Australian sandalwood, milky not smoky|A thread of saffron for warmth|Tonka rounds the drydown|Extremely skin-close after three hours|Good for scent-considerate offices',
    sp: 'Concentration~Eau de parfum 18 per cent||Volume~50 ml||Longevity~7-8 hours||Sillage~Close||Notes~Sandalwood, saffron, tonka||Family~Woody balsamic',
    va: 'Size~10 ml travel / 30 ml / 50 ml / 100 ml'
  },
  {
    n: 'Jasmine Index Eau de Parfum',
    s: 'Night-blooming jasmine, green stem and a low note of musk.',
    d: 'A sambac jasmine built with its own green, slightly tea-like stem note intact, so the flower keeps its edge instead of going indolic and heavy. A whisper of bergamot opens it and a clean musk closes it. It reads as a real flower, not as a candle.',
    de: 'Jasmine sambac with green stem intact|A touch of tea-like greenness|Bergamot opening, white musk base|Never indolic or animalic|Strongest in the first ninety minutes',
    sp: 'Concentration~Eau de parfum 16 per cent||Volume~50 ml||Longevity~6-8 hours||Sillage~Moderate to strong||Notes~Jasmine sambac, bergamot, musk||Family~White floral',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Oud Interval Extrait de Parfum', oos: 1,
    s: 'A smoked, rose-led oud that behaves itself in warm weather.',
    d: 'A synthetic accord that captures the dry, woody side of oud, with a small dose of rose and a resinous amber behind it. It has no barnyard sting, which makes it wearable where real oud usually is not. Three applications only, and one of them should be on a scarf.',
    de: 'Oud accord, dry and smoked rather than animalic|A small dose of rose|Resinous amber backbone|Highly concentrated, three sprays max|Wonderful on fabric for days',
    sp: 'Concentration~Extrait de parfum 24 per cent||Volume~30 ml||Longevity~10-14 hours||Sillage~Strong||Notes~Oud accord, rose, amber||Family~Oriental woody',
    va: 'Size~10 ml travel / 30 ml'
  },
  {
    n: 'Ember Saffron Eau de Parfum',
    s: 'Saffron and leather over amber, warm and slightly metallic.',
    d: 'A saffron-led opening with a faint metallic heat over soft leather and amber, built to be noticed without being loud. It behaves best in cool weather, where the resin stays pliable rather than cloying. Two sprays on the chest and one on the collar.',
    de: 'Saffron with a warm metallic edge|Soft leather absolute, not tarry|Amber keeps the base round|Cool-weather performance is better|Two to three applications is the dose',
    sp: 'Concentration~Eau de parfum 20 per cent||Volume~50 ml||Longevity~8-10 hours||Sillage~Moderate to strong||Notes~Saffron, leather, amber||Family~Oriental leather'
  },
  {
    n: 'Green Tea and Cedar Eau de Toilette',
    s: 'Steamed green tea, cedar needle and a saline top that reads cold.',
    d: 'A green, faintly bitter tea note over cedar needles and a mineral salt accord, made for people who find citrus too sharp and woods too heavy. It stays close to the skin and refreshes rather than announces. Good in the middle of a working day.',
    de: 'Bitter green tea absolute|Cedar needle freshness|A saline mineral top|Close to the skin throughout|Unscented-feeling restraint',
    sp: 'Concentration~Eau de toilette 12 per cent||Volume~50 ml||Longevity~4-6 hours||Sillage~Close||Notes~Green tea, cedar, salt accord||Family~Green aromatic',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Fig Leaf Water Eau de Toilette', nw: 1,
    s: 'Green fig, milky coconut leaf and a wet-stone coolness.',
    d: 'A sapchy green fig leaf note with a thin coconut milk accord and a mineral base that makes the whole thing smell slightly damp, in the best sense. It is the most photogenic scent we make and one of the most wearable in heat. Reapply generously; it is light by design.',
    de: 'Green fig leaf with a milky coconut trace|Mineral wet-stone base|Deliberately light and evaporative|Excellent in high humidity|Refillable aluminium travel size',
    sp: 'Concentration~Eau de toilette 10 per cent||Volume~50 ml||Longevity~3-5 hours||Sillage~Soft||Notes~Fig leaf, coconut, mineral||Family~Green aquatic',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Iso E Cloud Eau de Toilette',
    s: 'Iso E super, cedar and ambrette, sanded down to a halo.',
    d: 'A study in a single molecule: iso E super at a high dose with cedar and a musky ambrette underneath, velvety, translucent and hard to describe to anyone else. It seems to vanish and then reappear when someone stands close. A layering scent that makes other perfumes look warmer.',
    de: 'High-dose iso E super accord|Cedar and ambrette support|Velvety, translucent, faintly sweet|Appears and disappears with distance|Superb over any other scent in the range',
    sp: 'Concentration~Eau de toilette 14 per cent||Volume~50 ml||Longevity~6-8 hours||Sillage~Close, diffuse||Notes~Iso E super, cedar, ambrette||Family~Woody musk'
  },
  {
    n: 'Ambroxan 07 Eau de Parfum', ft: 1,
    s: 'Ambergris mineral warmth, saline and clean as a struck match.',
    d: 'A high dose of ambroxan with a saline top and a dry woody base, which reads at once like skin, like the sea and like nothing that has ever been bottled. It projects surprisingly far and lasts a long time on fabric. Wear it alone, or over a citrus to give the citrus a spine.',
    de: 'Ambroxan at a perfumer dose|Saline top with a dry woody base|Projects well beyond expectation|Lasts days on scarves and collars|Pairs with every citrus in the range',
    sp: 'Concentration~Eau de parfum 22 per cent||Volume~50 ml||Longevity~10-12 hours||Sillage~Strong||Notes~Ambroxan, salt, dry woods||Family~Mineral amber',
    va: 'Size~10 ml travel / 30 ml / 50 ml / 100 ml'
  },
  {
    n: 'Rose Ash Eau de Parfum',
    s: 'A damask rose pushed through woodsmoke and a little incense.',
    d: 'A real rose absolute held back by birch tar smoke and cool incense, so the flower never gets jammy or old-fashioned. It is the most dramatic scent in the collection and still an everyday one if you are careful with the trigger. Two sprays, on the collarbone, in cool weather.',
    de: 'Damask rose absolute, not jammy|Birch tar for dry woodsmoke|Cool incense in the base|Best in cool weather|Two applications is plenty',
    sp: 'Concentration~Eau de parfum 18 per cent||Volume~50 ml||Longevity~8-10 hours||Sillage~Moderate to strong||Notes~Rose, birch tar, incense||Family~Floriental smoke'
  },
  {
    n: 'Coffee Amber Extrait',
    s: 'Roasted coffee and amber, dark and savoury rather than sweet.',
    d: 'A coffee absolute with no sugar in sight, wrapped in amber and a trace of cardamom for lift. It is dense, slightly burnt and grown-up, closer to a dark roast at the bottom of a pot than to a dessert. Extremely concentrated; a single pass of the glass stopper is the dose.',
    de: 'Coffee absolute, unsweetened|Amber resin warmth with cardamom lift|Burnt, savoury, dense|Apply with the glass stopper, once|Lasts through a full working day',
    sp: 'Concentration~Extrait de parfum 25 per cent||Volume~20 ml||Longevity~12 hours plus||Sillage~Strong at close range||Notes~Coffee, amber, cardamom||Family~Gourmand resinous',
    va: 'Size~20 ml / 50 ml'
  },
  {
    n: 'Iris Powder Extrait',
    s: 'Orris butter and tonka under a veil of fine violet powder.',
    d: 'Aged orris butter at the centre, with violet leaf, tonka and a soft suede note that makes the whole thing smell like a powder room with the window open. It is cool-toned and dry, and it improves enormously on skin that has been moisturised. Six-hour wear from one application.',
    de: 'Aged orris butter, cool and dry|Violet leaf for a green powder effect|Tonka and soft suede underneath|Better on hydrated skin|One application lasts a workday',
    sp: 'Concentration~Extrait de parfum 24 per cent||Volume~20 ml||Longevity~6-8 hours||Sillage~Close, powdery||Notes~Orris, violet leaf, tonka||Family~Powdery floral',
    va: 'Size~20 ml / 50 ml'
  },
  {
    n: 'Tuberose Archive Eau de Parfum',
    s: 'Tuberose at full volume, with a green stalk and no coconut.',
    d: 'A heady tuberose built with its own green stalk note so it keeps a spine, plus a small jasmine dose and a sandalwood floor underneath. It is the most opulent scent in the range and the least suitable for an office in July. Wear it to be remembered.',
    de: 'Tuberose absolute with green stalk|Small jasmine dose for lift|Sandalwood floor keeps it from flying apart|Unapologetically opulent|One spray on the chest',
    sp: 'Concentration~Eau de parfum 20 per cent||Volume~50 ml||Longevity~8-10 hours||Sillage~Strong||Notes~Tuberose, jasmine, sandalwood||Family~White floral',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Cedar Salt Eau de Parfum',
    s: 'Needle, mineral salt and grey amber, cold and unhurried.',
    d: 'A cedar-heavy woody with a saline grey amber accord that pulls it in a cold, mineral direction, and a thread of vetiver underneath. It wears clean rather than warm and works in every season. The kind of scent people describe as tidy.',
    de: 'Cedar needle and wood|Grey amber for a saline mineral edge|Vetiver threads through the base|Wears cool, never sweet|All-season, office considerate',
    sp: 'Concentration~Eau de parfum 16 per cent||Volume~50 ml||Longevity~6-8 hours||Sillage~Moderate||Notes~Cedar, grey amber, vetiver||Family~Woody mineral'
  },
  {
    n: 'Rain on Stone Eau de Toilette',
    s: 'Petrichor: wet slate, geosmin and a green mineral hush.',
    d: 'Built around geosmin, the compound that gives the first rain on dry ground its smell, with violet leaf and a cool mineral accord behind it. It is literal, quiet and slightly uncanny, and it disappears sooner than the heavier flacons. Spray on the forearms so you can keep checking.',
    de: 'Geosmin at a low, convincing dose|Violet leaf for green coldness|Mineral slate accord underneath|Deliberately ephemeral|Reapply freely, it is gentle',
    sp: 'Concentration~Eau de toilette 12 per cent||Volume~50 ml||Longevity~3-5 hours||Sillage~Very close||Notes~Geosmin, violet leaf, mineral||Family~Green mineral'
  },
  {
    n: 'Chamomile Ink Eau de Toilette', nw: 1,
    s: 'Blue chamomile, hay and warm rice, calm in a bottle.',
    d: 'Roman chamomile with its apple-sweet blue oil intact, laid over dry hay, tonka and a note of steamed rice that keeps it savoury. It is the most soothing scent in the range and reads as quiet rather than herbal medicine. Lovely on a pillow spray, less so in a boardroom.',
    de: 'Roman chamomile blue oil|Dry hay and tonka warmth|A steamed-rice accord for savour|Soft, calming, close to skin|Also good as a linen mist',
    sp: 'Concentration~Eau de toilette 12 per cent||Volume~50 ml||Longevity~4-6 hours||Sillage~Close||Notes~Chamomile, hay, tonka||Family~Herbal balsamic',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Vanilla Bark Eau de Parfum',
    s: 'Vanilla used as a wood, with benzoin and black pepper.',
    d: 'A raw, unsweetened vanilla absolute treated like a resin, with benzoin, black pepper and a cedar underneath, so the result is smoky and dry rather than bakery-sweet. It is the vanilla for people who say they dislike vanilla. Long wear and gentle sillage at the same time.',
    de: 'Raw Madagascar vanilla absolute|Benzoin resin for a smoky dryness|Black pepper keeps the top awake|Not gourmand, not sweet|Long wear with moderate projection',
    sp: 'Concentration~Eau de parfum 18 per cent||Volume~50 ml||Longevity~8-10 hours||Sillage~Moderate||Notes~Vanilla absolute, benzoin, pepper||Family~Amber spicy'
  },
  {
    n: 'Lavender Vetiver Eau de Toilette',
    s: 'High-altitude lavender over a green vetiver, fougere without the soap.',
    d: 'A fresh lavender with a herbal, slightly camphorous top, sitting on a green vetiver and coumarin rather than the usual tonka-and-soap structure. It reads as classic and modern at once and behaves well in heat. Good on damp skin straight out of the shower.',
    de: 'Alpine lavender, herbal top|Green vetiver instead of a powdery base|Light coumarin for warmth|Heat-tolerant and clean-feeling|Apply to damp skin for even wear',
    sp: 'Concentration~Eau de toilette 13 per cent||Volume~50 ml||Longevity~5-6 hours||Sillage~Moderate||Notes~Lavender, vetiver, coumarin||Family~Aromatic fougere',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Black Tea Absolute Eau de Parfum',
    s: 'Steeped black tea, bergamot peel and a note of smoke at the rim.',
    d: 'A dried tea leaf absolute with a little bergamot and a whisper of lapsang smoke, bitter-ish, warm and faintly tannic in the way a good cup is. It wears closer than its concentration suggests and suits grey weather and wool. It is also, quietly, the best seller in the range.',
    de: 'Black tea absolute, tannic and warm|Bergamot peel for a bitter top|A whisper of lapsang smoke|Close wear for its strength|Excellent on wool and cotton',
    sp: 'Concentration~Eau de parfum 15 per cent||Volume~50 ml||Longevity~6-8 hours||Sillage~Close||Notes~Black tea, bergamot, smoke||Family~Aromatic tea',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'Leather Margin Eau de Parfum',
    s: 'Suede-textured leather with saffron and dry birch, quiet and matte.',
    d: 'A soft, matte leather built with an isobutyl quinoline note kept at a low level, plus saffron and cedar, so it reads as a well-worn book cover rather than a new car interior. It is unisex in the plainest sense and improves with age in the bottle. Three sprays maximum.',
    de: 'Matte suede leather accord|Saffron warmth in the opening|Cedar and a low-level quinoline note|Improves with six months in the bottle|Three applications maximum',
    sp: 'Concentration~Eau de parfum 18 per cent||Volume~50 ml||Longevity~8-9 hours||Sillage~Moderate||Notes~Leather, saffron, cedar||Family~Leather woody'
  },
  {
    n: 'Petitgrain Light Eau de Toilette',
    s: 'Bitter orange leaf, sparkling and short, for the hottest months.',
    d: 'A petitgrain-and-mandarin opening with a dry wood base that keeps it from becoming a cologne for teenagers. It evaporates honestly within four hours, which is the correct behaviour for a citrus in August. Keep the bottle in the fridge and use it after shaving.',
    de: 'Petitgrain with mandarin peel|Dry cedar base, no sweetness|Short by design, reapply freely|Ideal for high heat and post-shave|Fridge storage improves it',
    sp: 'Concentration~Eau de toilette 11 per cent||Volume~50 ml||Longevity~3-4 hours||Sillage~Soft||Notes~Petitgrain, mandarin, cedar||Family~Citrus aromatic',
    va: 'Size~10 ml travel / 30 ml / 50 ml'
  },
  {
    n: 'White Amber Eau de Toilette',
    s: 'A clean amber: musk, light wood and almost no resin.',
    d: 'The amber structure stripped of its heaviness, leaving a soft musky warmth with cedar and a mineral note, so it reads warm without ever reading sweet. This is the safest first bottle for someone who does not know what they like. It layers well beneath any of the florals.',
    de: 'Deconstructed amber, minimal resin|White musk for a warm floor|Cedar and mineral salt on top|Warm without sweetness|Ideal starting bottle for layering',
    sp: 'Concentration~Eau de toilette 12 per cent||Volume~50 ml||Longevity~5-7 hours||Sillage~Close to moderate||Notes~Amber accord, musk, cedar||Family~Amber musk'
  },
  {
    n: 'Amber Roll-On Perfume Oil',
    s: 'The amber formula, in a fractionated coconut base, at twelve per cent.',
    d: 'A roll-on oil version of the amber accord, diluted in fractionated coconut oil with vitamin E, which means no alcohol and no spray cloud in a shared room. It stays close to the skin for four or five hours and is easy to reapply at a desk. Good for people whose skin finds alcohol drying.',
    de: 'Alcohol-free perfume oil base|Fractionated coconut with vitamin E|Roll onto pulse points|Close wear, easy to top up|No spray, travel-bag safe',
    sp: 'Concentration~Perfume oil 12 per cent||Volume~10 ml roll-on||Longevity~4-5 hours||Sillage~Close||Notes~Amber, musk, sandalwood||Base~Fractionated coconut oil'
  },
  {
    n: 'Discovery Trio', nw: 1, b: 'Travel size',
    s: 'Three 5 ml sprays of the range, in a cotton pouch you might keep.',
    d: 'Ivory Thread, Vetiver Hour and Ambroxan 07 in refillable 5 ml sprays, which is the only reasonable way to find out which of the three you actually want to live in. The atomisers are real, not the sample bulbs that fail after two uses. Return the pouch and we refill the sprays at a discount.',
    de: 'Three refillable 5 ml atomisers|Ivory Thread, Vetiver Hour, Ambroxan 07|Refillable and returnable|Cotton drawstring pouch included|Atomisers tested for two hundred uses',
    sp: 'Volume~3 x 5 ml||Concentration~Eau de parfum||Contents~Ivory Thread, Vetiver Hour, Ambroxan 07||Case~Cotton pouch||Refill~Atomisers refillable'
  },
  {
    n: 'Neroli Body Mist',
    s: 'A light, low-alcohol mist for the body that smells like an orange grove.',
    d: 'A generous body mist with neroli, a little honeyed flower and a soft musk, at a concentration low enough to use after a shower without thinking about it. It lasts about two hours on skin and much longer on a cotton T-shirt. The bottle is big because it is not meant to be rationed.',
    de: 'Low concentration for body use|Neroli with honeyed orange flower|Lasts longer on fabric than on skin|Alcohol-light base with glycerin|Generous 200 ml, no rationing needed',
    sp: 'Concentration~Body mist 6 per cent||Volume~200 ml||Longevity~2-3 hours||Sillage~Soft||Notes~Neroli, orange flower, musk||Family~Citrus floral',
    va: 'Size~60 ml / 200 ml'
  }
];

/* ------------------------------------------------------------------ *
 * BEAUTY ACCESSORIES — 20
 * ------------------------------------------------------------------ */
const ACCESSORIES = [
  {
    n: 'Fluffy Powder Brush', ft: 1, b: 'Vegan',
    s: 'A domed fibre brush that puts powder on and takes the excess away.',
    d: 'A soft domed brush with taklon fibres cut at two lengths, so it picks up a small amount of powder and distributes it without a patch of matte appearing on the cheek. The handle is weighted aluminium, short enough to control. It sheds nothing after forty washes, which is the actual test.',
    de: 'Dual-length taklon synthetic fibres|Domed cut for a soft, diffused line|Weighted aluminium handle|Hand-washed weekly, dries overnight|Vegan, no animal hair',
    sp: 'Material~Taklon fibre, aluminium ferrule||Dimensions~21 cm total length||Use~Loose and pressed powder||Handle~Anodised aluminium||Care~Wash weekly, dry flat'
  },
  {
    n: 'Precision Concealer Brush',
    s: 'A small flat brush for under the eyes and around the nose.',
    d: 'A densely packed, slightly rounded concealer brush that presses product into the inner corner and along the nose without dragging the thin skin there. The ferrule is crimped so the bristles will not splay with daily use. It works equally well for correcting a single mark.',
    de: 'Dense, rounded flat tip|Press rather than swipe|Crimped ferrule resists splaying|Small enough for the inner corner|Vegan synthetic fibre',
    sp: 'Material~Synthetic taklon, stainless ferrule||Dimensions~16 cm total length||Use~Concealer, spot correction||Bristle~Dense flat||Care~Wash after each use'
  },
  {
    n: 'Angled Brow Brush',
    s: 'A stiff, cut-angle brush that draws a line and then softens it.',
    d: 'A firm, sharply angled brush with enough spring to lay pomade along a clean bottom edge, then flick the top soft with the same stroke. The fibres are synthetic and slightly coarse, which is what holds a pomade line. Short handle, so it stays accurate at the tail.',
    de: 'Firm cut angle for a crisp edge|Slightly coarse synthetic fibre holds pomade|Short handle for accuracy|Use with the flat side, not the tip|Vegan, washes clean',
    sp: 'Material~Synthetic fibre, wooden handle||Dimensions~15 cm total length||Angle~45 degree cut||Use~Pomade and powder brows||Care~Rinse daily with soap'
  },
  {
    n: 'Silicone Cleansing Pad',
    s: 'A soft silicone pad that takes sunscreen off without a scrub.',
    d: 'A flexible silicone pad with fine nubs that work cleanser into the pores by vibration and slip rather than abrasion, then rinses clean in one shake. It dries in seconds and never grows anything unpleasant in a bathroom corner. Use it with your existing cleanser, on damp skin, for a minute.',
    de: 'Fine silicone nubs, non-abrasive|Rinses clean and dries fast|No bacteria harbouring like a cloth|Use with any gel or cream cleanser|One minute on damp skin',
    sp: 'Material~Food-grade silicone||Dimensions~9 cm x 6 cm||Use~With cleanser, morning or night||Care~Rinse and air dry||Battery~None required'
  },
  {
    n: 'Sonic Facial Cleansing Brush', nw: 1,
    s: 'A slow sonic brush with three settings and a charge that lasts a month.',
    d: 'A compact sonic cleansing brush with soft silicone touchpoints and three gentle speeds, sized to reach the jawline and the sides of the nose where hands habitually miss. It is waterproof, charges over USB-C and turns itself off after a minute. Use it at night only if your skin is reactive.',
    de: 'Three speeds, 8000 movements a minute|Food-grade silicone touchpoints|Waterproof, USB-C, one month per charge|Automatic one-minute timer|Nightly use only on sensitive skin',
    sp: 'Material~Silicone, ABS body||Dimensions~13 cm handheld||Settings~3 speeds||Charging~USB-C, 30 days per charge||Water rating~IPX7'
  },
  {
    n: 'Cushion Makeup Sponge, Two Pack',
    s: 'Two non-absorbent sponges that bounce foundation in rather than drink it.',
    d: 'A pair of high-density sponges with a closed cell structure, so they take a fraction of the foundation a ordinary sponge does and give a smooth airbrushed surface when you bounce rather than drag. Use them slightly damp for a dewy finish and dry for more coverage. The flat edge is for under the eye.',
    de: 'Closed-cell foam, low product absorbency|Bounce, never drag|Damp for dewy, dry for coverage|Flat edge for the under-eye|Two sponges, replace every three months',
    sp: 'Material~Latex-free polyurethane||Dimensions~6 cm teardrop||Quantity~2 sponges||Use~Liquid and cream base||Care~Wash weekly, air dry'
  },
  {
    n: 'Microfiber Makeup Remover Cloth',
    s: 'A plain cloth and warm water, which is genuinely enough.',
    d: 'A dense microfiber cloth that lifts long-wear makeup, including mascara, with warm water alone, in about ninety seconds of patient pressing and short strokes. It comes with a second, smaller cloth for the eyes and a mesh wash bag. Wash them without fabric softener or they stop working.',
    de: 'Works with warm water alone, no product|Second small cloth for the eyes|Removes waterproof mascara in ninety seconds|Mesh wash bag included|No fabric softener, air dry',
    sp: 'Material~Polyamide polyester microfiber||Dimensions~22 cm and 12 cm cloths||Quantity~2 cloths with bag||Use~Face and eyes||Care~Machine wash 40 C, no softener'
  },
  {
    n: 'Quartz Facial Roller', oos: 1,
    s: 'A cool stone roller for the morning face and the evening serum.',
    d: 'A single-piece quartz roller with a smaller end for the under-eye and a larger one for the cheeks, used to move a serum in and take the sleepy puffiness down. Keep it cool, always press outward and upward, and clean the stone between uses. It will not sculpt anything, but it feels extraordinary.',
    de: 'One solid piece, no glued joints|Small end for the under-eye|Store cool for morning puffiness|Press outward and upward only|Wipe with soap and water after use',
    sp: 'Material~Natural quartz||Dimensions~15 cm total length||Use~Over serums and moisturiser||Care~Wash after each use||Origin~Cut and polished stone'
  },
  {
    n: 'Stainless Steel Gua Sha',
    s: 'A non-porous steel tool you can actually keep clean.',
    d: 'A solid stainless tool with three edges, cut for the jawline, the cheekbone and the brow, which glides over facial oil without stretching the skin. Unlike stone it will not chip in a bathroom shelf and it can be washed properly after every use. Four minutes a day, and the morning face looks less puffy.',
    de: 'Three contoured edges for jaw, cheek and brow|Glides over facial oil, never on dry skin|Non-porous, fully washable|Will not chip like stone|Four minutes, daily',
    sp: 'Material~Surgical-grade stainless steel||Dimensions~9 cm x 6 cm||Use~With facial oil||Care~Soap and water after each use||Weight~110 g'
  },
  {
    n: 'Satin-Lined Hair Claw',
    s: 'A large clip with a satin interior so the updo does not crease.',
    d: 'A heavyweight acetate claw lined with satin on the inner teeth, which is what stops the dent-and-frizz pattern a bare plastic clip leaves at the back of the head. It holds thick hair all day without loosening. Also the best tool for taking a braid out without a fight.',
    de: 'Satin-lined inner teeth|Holds thick and heavy hair|No crease pattern when released|Acetate, not injected plastic|Two sizes in one pack',
    sp: 'Material~Acetate with satin lining||Dimensions~9 cm and 6 cm clips||Quantity~2 clips||Hair Type~All, thick and curly friendly||Care~Spot clean the satin'
  },
  {
    n: 'Silk Sleep Bonnet',
    s: 'A double-layer silk cap that keeps a style intact to the pillow.',
    d: 'A double-layer mulberry silk bonnet with a wide, flat elastic band at the forehead, so a blow-dry or a set of curls survives the night without moving. It does not squeeze the head, and the satin lining against the hair is the point. Machine wash cold in a bag and hang to dry.',
    de: 'Double-layer 22 momme mulberry silk|Flat elastic band, no temple pressure|Keeps styling intact overnight|Fits shoulder-length to waist-length hair|Machine wash cold in a mesh bag',
    sp: 'Material~22 momme mulberry silk||Size~One size, adjustable band||Care~Machine wash cold, hang dry||Colour~Ink, Bone||Closure~Flat covered elastic'
  },
  {
    n: 'Microfiber Waffle Hair Towel',
    s: 'A waffle-weave towel that cuts twenty minutes out of blow-drying.',
    d: 'A fast-absorbing microfiber towel in a waffle weave, which pulls water out of the hair far quicker than terry does and leaves far less frizz because there is nothing to rub with. Twist, do not rub, and leave it on while you do the rest of the routine. It dries overnight on a rail.',
    de: 'Waffle weave, not terry|Twist and clamp instead of rubbing|Cuts drying time noticeably|Reduces the frizz caused by rubbing|Dries overnight on a rail',
    sp: 'Material~Polyamide microfiber||Dimensions~40 cm x 70 cm||Care~Machine wash 30 C, no softener||Fastening~Button loop||Colour~Ash, Clay'
  },
  {
    n: 'Mulberry Silk Pillowcase',
    s: 'A pillowcase with a hidden zip and enough silk to fold under.',
    d: 'A 22 momme mulberry silk case with an envelope fold long enough to stay put on a deep mattress, which is where the friction on hair and the crease on the cheek get solved. It is not a skincare product and does not claim to be; it is simply less abrasive than cotton at three in the morning. Machine wash cold, no bleach.',
    de: '22 momme mulberry silk|Envelope fold, no exposed zip|Stays on a deep mattress|Less morning creasing than cotton|Machine wash cold in a bag',
    sp: 'Material~100 per cent mulberry silk||Size~Standard 50 x 75 cm||Size 2~King 50 x 90 cm||Care~Machine wash cold, no bleach||Closure~Envelope fold'
    , va: 'Size~Standard / King'
  },
  {
    n: 'Bamboo Detangling Comb',
    s: 'A wide-tooth bamboo comb with rounded tips for wet hair.',
    d: 'A single-piece bamboo comb with widely spaced, hand-rounded teeth that goes through wet, conditioned hair from the ends upward without snapping anything. Bamboo is light, it does not build static, and it will not warp if you hang it up rather than leave it in the shower. It takes a belt of product off, too.',
    de: 'Hand-rounded wide teeth|Start at the ends, work upward|No static, unlike plastic|Single piece, will not snap at the spine|Hang to dry, do not leave wet',
    sp: 'Material~Bamboo, oil finish||Dimensions~22 cm x 4 cm||Teeth~Wide, rounded||Use~Wet and dry hair||Care~Hang dry, oil finish yearly'
  },
  {
    n: 'Stainless Slant Tweezers',
    s: 'Japanese steel, hand-aligned tips, and a grip that stops the slipping.',
    d: 'A pair of slant-tip tweezers cut from hardened Japanese stainless and aligned by hand so the two edges meet along their full length, which is the difference between pulling a hair and snapping it. The knurl on the barrel keeps them steady with damp fingers. They stay sharp for years and can be sent back for realigning.',
    de: 'Hardened Japanese stainless steel|Tips aligned by hand, edge to edge|Knurled barrel, no slipping with wet hands|Pulls rather than snaps the hair|Send back for realignment, no charge',
    sp: 'Material~Japanese stainless steel||Length~9.5 cm||Tip~Slant, 0.15 mm fine||Finish~Matte knurled||Warranty~Realignment for life'
  },
  {
    n: 'Professional Lash Curler',
    s: 'A sprung steel curler with a replaceable pad that does not pinch.',
    d: 'A well-sprung curler with a genuinely curved frame suited to flatter eye shapes, and a silicone pad that gives at exactly the right pressure. Three pulses at the root, mid-length and tip will hold a curl all day on straight lashes. The pads and the whole mechanism are replaceable, so it is the last one you buy.',
    de: 'Curved frame for flatter eye shapes|Soft silicone pad, replaceable|Three pulses: root, mid, tip|Sprung hinge will not pinch|Pads and springs sold separately',
    sp: 'Material~Nickel-plated steel, silicone pad||Dimensions~11 cm length||Pad~Replaceable silicone||Eye Shape~Medium to deep set||Care~Wipe pad weekly, replace monthly'
  },
  {
    n: 'Illuminated Travel Mirror',
    s: 'A fold-flat mirror with true daylight and a charge you forget about.',
    d: 'A slim, fold-flat mirror with LEDs tuned to daylight at 5000 K and a dimmer that goes bright enough for eyeliner in a dark hotel bathroom. It runs about forty minutes on a charge, folds to a centimetre thick and stands on its own base. The glass version of this product would not survive a bag; this one is acrylic.',
    de: '5000 K daylight LEDs with dimmer|About forty minutes per USB-C charge|Folds flat to a centimetre|Self-standing base|Shatter-resistant acrylic mirror',
    sp: 'Material~ABS, acrylic mirror||Dimensions~18 cm x 13 cm folded||Light~5000 K, three brightness levels||Battery~Rechargeable, USB-C||Magnification~1x and 5x inset'
  },
  {
    n: 'Brush Roll Organiser', nw: 1,
    s: 'A waxed cotton roll with elastic loops and a real place for eight tools.',
    d: 'A roll-up organiser in water-resistant waxed cotton with elastic sockets sized for a powder brush, three eye brushes, a concealer brush, tweezers, a curler and a liner pencil. It unrolls flat on a hotel counter, which is the only way to find the right one at speed. The ends fold over and stay closed with a brass stud.',
    de: 'Waxed cotton, water resistant|Nine elastic sockets plus two flat pockets|Unrolls flat on a counter|Brass stud closure|Wipes clean, machine wash cold',
    sp: 'Material~Waxed cotton, brass||Dimensions~26 cm x 22 cm open||Capacity~9 brush sockets||Closure~Brass stud||Care~Wipe clean, cold wash'
  },
  {
    n: 'Silicone Travel Bottle Set',
    s: 'Five squeezable bottles with wide tops that do not leak in a bag.',
    d: 'A set of five soft silicone bottles with wide, flip-open tops and a genuine seal, sized to the 100 ml cabin limit and easier to empty than the stiff plastic ones. The flat sides mean they do not roll around inside a toiletry bag. Clean with warm soapy water and dry with the caps off.',
    de: 'Five bottles, cabin-legal at 100 ml|Wide flip-top, real seal, no leaks|Squeezes fully, so you get the last of it|Flat sides, no rolling in the bag|Label stickers included',
    sp: 'Material~Food-grade silicone, PP||Sizes~3 x 100 ml, 2 x 60 ml||Closure~Flip-top with seal||Use~Liquids, creams, oils||Care~Warm soapy water, air dry'
  },
  {
    n: 'Pumice and Foot File Duo',
    s: 'One natural stone and one stainless file, for the end of a long day.',
    d: 'A pair of foot tools: a genuine volcanic pumice stone for general roughness and a fine stainless file with two grits for the edge of the heel. Both have long handles so you are not contorted over a basin, and both dry quickly on a hook. Work on dry skin only, and never past the point of comfort.',
    de: 'Natural volcanic pumice stone|Stainless file with coarse and fine grit|Long handles, no contortion|Dry on a hook between uses|Use on dry skin only',
    sp: 'Material~Volcanic pumice, stainless steel||Dimensions~20 cm handles||Grit~Coarse and fine on the file||Use~Dry skin, after a shower||Care~Rinse and hang dry'
  }
];

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */
const GROUPS = [
  ['skincare', SKINCARE, { featured: 4, isNew: 6, oos: 2 }],
  ['makeup', MAKEUP, { featured: 3, isNew: 5, oos: 2 }],
  ['haircare', HAIRCARE, { featured: 2, isNew: 4, oos: 2 }],
  ['perfumes', PERFUMES, { featured: 2, isNew: 3, oos: 1 }],
  ['beauty-accessories', ACCESSORIES, { featured: 1, isNew: 2, oos: 1 }]
];

const TARGET_TOTAL = 200;
const BASE_COST = 46;
const PROFIT = 6;
const SELLING_PRICE = BASE_COST + PROFIT; // Selling Price = Base Price + Profit

const parseSpecs = (raw) =>
  String(raw || '')
    .split('||')
    .map((pair) => pair.split('~'))
    .filter((pair) => pair.length === 2)
    .map(([k, v]) => ({ k: k.trim(), v: v.trim() }));

const parseVariants = (raw) => {
  if (!raw) return [];
  return raw.split(' ; ').map((group) => {
    const [name, list] = group.split('~');
    return {
      name: name.trim(),
      options: list
        .split(' / ')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 8)
    };
  });
};

const problems = [];
const seenSlugs = new Map();
const seenDescriptions = new Set();
const products = [];

for (const [category, entries, quota] of GROUPS) {
  let featured = 0;
  let fresh = 0;
  let empty = 0;

  for (const entry of entries) {
    const slug = slugify(entry.n);
    const price = SELLING_PRICE;
    const compareAt = 58 + (num(slug, 0, 6) % 32); // 58-89, always above price
    const stock = entry.oos ? 0 : 8 + (num(slug, 6, 6) % 83); // 8-90
    const rating = Math.round((4.3 + (num(slug, 12, 4) % 8) / 10) * 10) / 10; // 4.3-5.0
    const reviewCount = 14 + (num(slug, 16, 6) % 366);

    const product = {
      id: slug,
      slug,
      name: entry.n.trim(),
      category,
      price,
      compareAt,
      badge: entry.b || null,
      rating,
      reviewCount,
      stock,
      featured: Boolean(entry.ft),
      isNew: Boolean(entry.nw),
      short: entry.s.trim(),
      description: entry.d.trim(),
      details: String(entry.de)
        .split('|')
        .map((line) => line.trim())
        .filter(Boolean),
      specs: parseSpecs(entry.sp),
      variants: parseVariants(entry.va),
      image: `/images/catalog/${slug}.svg`,
      baseCost: BASE_COST,
      profit: PROFIT,
      priceMode: 'formula'
    };

    if (product.featured) featured += 1;
    if (product.isNew) fresh += 1;
    if (product.stock === 0) empty += 1;

    /* --- guard rails, mirroring the storefront validation rules --- */
    const fail = (message) => problems.push(`${product.name}: ${message}`);

    if (product.name.length < 2 || product.name.length > 90) fail('name length');
    if (!slug || slug.length > 64) fail('slug length or emptiness');
    if (seenSlugs.has(slug)) fail(`duplicate slug shared with ${seenSlugs.get(slug)}`);
    seenSlugs.set(slug, product.name);
    if (seenDescriptions.has(product.description)) fail('duplicate description');
    seenDescriptions.add(product.description);
    if (product.price !== SELLING_PRICE || product.compareAt <= product.price) fail('pricing rule');
    if (product.badge !== null && product.badge.length > 24) fail('badge length');
    if (product.short.length > 220) fail('short length');
    if (product.description.length < 10 || product.description.length > 2000) fail('description length');
    if (product.details.length > 10 || product.details.some((line) => line.length > 220)) fail('details');
    if (product.specs.length === 0 || product.specs.length > 10) fail('spec count');
    if (product.specs.some((spec) => !spec.k || !spec.v || spec.k.length > 60 || spec.v.length > 120)) fail('spec limits');
    if (product.variants.length > 4) fail('variant group count');
    if (product.variants.some((variant) => !variant.name || variant.name.length > 40 || !variant.options.length)) fail('variant shape');
    if (product.variants.some((variant) => variant.options.some((option) => option.length > 40))) fail('variant option length');
    if (!Number.isInteger(product.stock) || product.stock < 0 || product.stock > 100000) fail('stock');
    if (/[$₹<>&]|href=/i.test(product.short + product.description + product.details.join(' '))) fail('forbidden characters in copy');
    if (!product.image.startsWith('/images/')) fail('image path');

    products.push(product);
  }

  if (featured !== quota.featured) problems.push(`${category}: expected ${quota.featured} featured, found ${featured}`);
  if (fresh !== quota.isNew) problems.push(`${category}: expected ${quota.isNew} new, found ${fresh}`);
  if (empty !== quota.oos) problems.push(`${category}: expected ${quota.oos} out of stock, found ${empty}`);
}

const counts = products.reduce((acc, product) => {
  acc[product.category] = (acc[product.category] || 0) + 1;
  return acc;
}, {});
const EXPECTED = { skincare: 60, makeup: 50, haircare: 40, perfumes: 30, 'beauty-accessories': 20 };
for (const [slug, size] of Object.entries(EXPECTED)) {
  if (counts[slug] !== size) problems.push(`category ${slug}: expected ${size}, found ${counts[slug] || 0}`);
}
if (products.length !== TARGET_TOTAL) problems.push(`expected ${TARGET_TOTAL} products, found ${products.length}`);
if (products.filter((product) => product.stock === 0).length !== 8) problems.push('expected exactly 8 out-of-stock products');
if (products.filter((product) => product.featured).length !== 12) problems.push('expected exactly 12 featured products');
if (products.filter((product) => product.isNew).length !== 20) problems.push('expected exactly 20 new products');

if (problems.length) {
  console.error('Catalog build blocked by the following problems:\n');
  for (const problem of problems) console.error('  - ' + problem);
  process.exit(1);
}

const out = path.join(ROOT, 'data', 'cosmetics.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(products, null, 2)}\n`, 'utf8');

console.log(`Wrote ${products.length} products to ${path.relative(ROOT, out)}`);
console.log(`Categories: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(', ')}`);
console.log(`Featured ${products.filter((p) => p.featured).length} | New ${products.filter((p) => p.isNew).length} | Out of stock ${products.filter((p) => p.stock === 0).length}`);
console.log(`Price ${SELLING_PRICE} = base ${BASE_COST} + profit ${PROFIT}; compare-at ${Math.min(...products.map((p) => p.compareAt))}-${Math.max(...products.map((p) => p.compareAt))}`);




