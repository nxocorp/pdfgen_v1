-- SQLite
SELECT fi.*
FROM form_instances fi
JOIN documents d ON d.id = fi.document_id
WHERE d.aircraft_model = 'UH-60R'
  AND fi.form_type = '2408-17';


SELECT
  d.tail_number,
  fi.id AS instance_id,
  json_extract(fi.data_json, '$.header.serialNumber') AS serial_number
FROM form_instances fi
JOIN documents d ON d.id = fi.document_id
WHERE d.aircraft_model = 'UH-60R'
  AND fi.form_type = '2408-17';

SELECT
  d.tail_number,
  fi.id AS instance_id,
  json_extract(fi.data_json, '$.header') AS header
FROM form_instances fi
JOIN documents d ON d.id = fi.document_id
WHERE d.aircraft_model = 'UH-60R'
  AND fi.form_type = '2408-17';  

SELECT
  d.tail_number,
  fi.id AS instance_id,
  je.key   AS field_key,
  je.value AS field_value
FROM form_instances fi
JOIN documents d ON d.id = fi.document_id,
     json_each(fi.data_json, '$.header') AS je
WHERE d.aircraft_model = 'UH-60R'
  AND fi.form_type = '2408-17';